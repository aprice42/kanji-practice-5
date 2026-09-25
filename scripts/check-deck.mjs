/* Confirms the generated files still match the deck. Run with `npm run check`
   after adding cards, before `npm run build`.

   Every generator here validates its own output, but nothing used to check that
   the outputs were built from the CURRENT source. Adding cards and
   forgetting a step leaves a tree where everything "succeeds" and the app is
   quietly wrong — a new kanji renders in a Chinese fallback face, or cannot be
   traced at all. Both failure modes are documented in README.md, and being
   documented is what already failed: the font one shipped.

   So this is the check that makes those steps hard to skip rather than merely
   written down. It regenerates nothing and writes nothing. */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseCards, isFilled, duplicateReadings, isAllowedCollision,
  deckCharacters, isJapanese, isTraceable, GRADES,
} from './deck.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const problems = []
const fail = (headline, fix) => problems.push({ headline, fix })

/* 1. src/cards.js was built from the current sources ---------------------- */

/* Re-derive what `npm run cards` would emit, by reading the same directories in
   the same order. The derivation is deliberately written out again here rather
   than imported from the generator: a check that shares the generator's idea of
   what a deck is cannot catch the generator being wrong about it.

   GRADES is the exception, and is imported. Which files exist and what they are
   called is data, not derivation — and three hand-kept copies of it had already
   drifted apart, which is a worse failure than the one the duplication guards
   against. */

const sources = []

const worksheetDir = join(root, 'content/worksheets')
for (const file of existsSync(worksheetDir) ? readdirSync(worksheetDir).sort() : []) {
  if (!file.endsWith('.md') || file === 'README.md') continue
  const name = file.replace(/\.md$/, '')
  const parsed = parseCards(read(`content/worksheets/${file}`))
  const rows = parsed.groups.flatMap((g) => g.rows)
  sources.push({
    id: `w:${name}`,
    label: parsed.title || name,
    set: `w:${name}`,
    grade: null,
    rows: rows.filter(isFilled),
    words: rows.length,
    notes: parsed.groups.reduce((n, g) => n + g.notes.length, 0),
  })
}

for (const { file, prefix, label, grade, set } of GRADES) {
  if (!existsSync(join(root, 'content/words', file))) continue
  const parsed = parseCards(read(`content/words/${file}`))
  parsed.groups.forEach((group, i) => {
    sources.push({
      id: `${prefix}:${i + 1}`,
      label: `${label} · Group ${i + 1}`,
      set,
      grade,
      rows: group.rows.filter(isFilled),
      words: group.rows.length,
      notes: group.notes.length,
    })
  })
}

const { cards, DECKS, SETS } = await import(new URL('../src/cards.js', import.meta.url))

/* A duplicate reading inside one deck would let a single round ask a question
   with two correct answers. Across decks it is the syllabus re-teaching a word
   as more of its kanji arrive, and is reported at the foot of this run. */
for (const source of sources) {
  for (const collision of duplicateReadings(source.rows)) {
    if (isAllowedCollision(collision)) continue
    fail(
      `${source.id} has two cards reading "${collision.reading}" — ${collision.forms.join(' and ')}.`,
      'Give one of them a different reading, or name it in ALLOWED_COLLISIONS in scripts/deck.mjs if the source really prints both.'
    )
  }
}

/* The grade of each written form, re-derived the same way the generator does —
   from the curriculum, then looked up for worksheet cards. */
const gradeOfForm = new Map()
for (const s of sources) {
  if (s.grade == null) continue
  for (const [, written] of s.rows) gradeOfForm.set(written, s.grade)
}

const expected = sources.flatMap((s) =>
  s.rows.map(([reading, written, meaning]) => ({
    reading,
    written,
    meaning,
    deck: s.id,
    grade: s.grade ?? gradeOfForm.get(written) ?? null,
    set: s.set,
  }))
)
const same =
  expected.length === cards.length &&
  expected.every(
    (e, i) =>
      e.reading === cards[i].reading &&
      e.written === cards[i].written &&
      e.meaning === cards[i].meaning &&
      /* `deck` is compared too. Without it a cards.js generated before decks
         existed passes every other check and the app silently plays one flat
         deck of everything. The same reasoning now covers `grade` and `sets`:
         a stale cards.js from before sets existed must not pass. */
      e.deck === cards[i].deck &&
      e.grade === cards[i].grade &&
      cards[i].sets?.length === 1 &&
      e.set === cards[i].sets[0]
  )
if (!same) {
  fail(
    `src/cards.js does not match content/ (${cards.length} cards vs ${expected.length} rows).`,
    'npm run cards'
  )
}

/* Every card belongs to a deck the manifest knows about, and the manifest's
   counts are the ones the sheet will show. */
const manifest = new Map((DECKS ?? []).map((d) => [d.id, d]))
if (!DECKS) {
  fail('src/cards.js exports no DECKS manifest.', 'npm run cards')
} else {
  const unknown = [...new Set(cards.map((c) => c.deck))].filter((id) => !manifest.has(id))
  if (unknown.length) {
    fail(`Cards name ${unknown.length} deck(s) the manifest does not list: ${unknown.join(', ')}.`, 'npm run cards')
  }
  const miscounted = sources.filter(
    (s) => manifest.has(s.id) && (manifest.get(s.id).cards !== s.rows.length || manifest.get(s.id).words !== s.words)
  )
  if (miscounted.length) {
    fail(`The DECKS manifest miscounts ${miscounted.map((s) => s.id).join(', ')}.`, 'npm run cards')
  }
}

/* Every card's set is in the SETS manifest, and the manifest's counts are the
   ones the picker will show. Sets are re-derived here by rolling the sources up
   rather than by reading the manifest, so a generator that rolls up wrongly
   fails rather than agreeing with itself. */
if (!SETS) {
  fail('src/cards.js exports no SETS manifest.', 'npm run cards')
} else {
  const rolled = new Map()
  for (const s of sources) {
    const set = rolled.get(s.set) ?? { cards: 0, words: 0 }
    set.cards += s.rows.length
    set.words += s.words
    rolled.set(s.set, set)
  }

  const listed = new Map(SETS.map((s) => [s.id, s]))
  const unknown = [...new Set(cards.map((c) => c.sets?.[0]))].filter((id) => !listed.has(id))
  if (unknown.length) {
    fail(`Cards name ${unknown.length} set(s) the manifest does not list: ${unknown.join(', ')}.`, 'npm run cards')
  }
  const missing = [...rolled.keys()].filter((id) => !listed.has(id))
  if (missing.length) fail(`The SETS manifest is missing: ${missing.join(', ')}.`, 'npm run cards')

  const wrong = [...rolled].filter(
    ([id, n]) => listed.has(id) && (listed.get(id).cards !== n.cards || listed.get(id).words !== n.words)
  )
  if (wrong.length) {
    fail(`The SETS manifest miscounts ${wrong.map(([id]) => id).join(', ')}.`, 'npm run cards')
  }
}

/* 2. Every character has stroke data --------------------------------------- */

const { strokes } = await import(new URL('../src/strokes.js', import.meta.url))
const written = [...new Set(cards.flatMap((c) => [...c.written]))]
const noStrokes = written.filter((ch) => isTraceable(ch) && !strokes[ch])
if (noStrokes.length) {
  fail(
    `No stroke data for ${noStrokes.join(' ')} — Trace mode skips ${noStrokes.length === 1 ? 'it' : 'them'} silently.`,
    'npm run strokes'
  )
}

/* 3. Stroke data is well formed -------------------------------------------- */

const ARITY = { M: 2, m: 2, L: 2, l: 2, C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, H: 1, h: 1, V: 1, v: 1, Z: 0, z: 0 }
const NUM = /-?(?:\d+\.\d+|\.\d+|\d+)/g
const malformed = []
for (const [ch, paths] of Object.entries(strokes)) {
  paths.forEach((d, i) => {
    for (const segment of d.match(/[A-Za-z][^A-Za-z]*/g) || []) {
      const arity = ARITY[segment[0]]
      const count = (segment.slice(1).match(NUM) || []).length
      if (arity === undefined || (arity === 0 ? count > 0 : count % arity !== 0)) {
        malformed.push(`${ch} stroke ${i + 1}`)
        return
      }
    }
  })
}
if (malformed.length) {
  fail(
    `Malformed stroke paths: ${malformed.slice(0, 8).join(', ')}${malformed.length > 8 ? ` and ${malformed.length - 8} more` : ''}.`,
    'npm run strokes'
  )
}

/* 4. Every character is in the font subset ---------------------------------- */

if (!existsSync(join(root, 'public/fonts/subset.txt'))) {
  fail('public/fonts/subset.txt is missing, so the font subset cannot be checked.', 'npm run fonts')
} else {
  const subset = new Set(read('public/fonts/subset.txt'))
  const missing = [...deckCharacters(cards)].filter((ch) => isJapanese(ch) && !subset.has(ch))
  if (missing.length) {
    fail(
      `Not in the font subset: ${missing.join(' ')} — ${missing.length === 1 ? 'it falls' : 'they fall'} back to a system face, which on some devices draws Chinese shapes.`,
      'npm run fonts'
    )
  }
}

/* ------------------------------------------------------------------------- */

const blank = sources.reduce((n, s) => n + (s.words - s.rows.length), 0)
const flagged = sources.reduce((n, s) => n + s.notes, 0)

if (!problems.length) {
  console.log(`${cards.length} cards across ${sources.length} decks, ${written.length} characters.`)
  console.log('cards.js matches content/; every character has stroke data and a glyph in the font subset.\n')

  /* Progress, not a verdict. A blank row is simply not a card yet, and a flag
     routes a reviewer's attention — neither is a failure, and making either one
     fail would leave the app unbuildable for as long as the content job runs. */
  for (const s of sources) {
    const b = s.words - s.rows.length
    if (!b && !s.notes) continue
    console.log(
      `  ${s.id.padEnd(16)} ${String(s.rows.length).padStart(3)} of ${String(s.words).padStart(3)} filled` +
        `${b ? `   ${b} blank` : ''}${s.notes ? `   ${s.notes} flagged` : ''}`
    )
  }
  if (blank || flagged) console.log(`\n  ${blank} row(s) still blank, ${flagged} flagged for review. Neither is a failure.`)

  const crossDeck = duplicateReadings(cards.map((c) => [c.reading, c.written]))
  if (crossDeck.length) {
    console.log(`  ${crossDeck.length} reading(s) span more than one deck — the syllabus re-teaching a word.`)
  }
  process.exit(0)
}

console.error(`${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`)
for (const { headline, fix } of problems) console.error(`  ${headline}\n    fix: ${fix}\n`)
process.exit(1)
