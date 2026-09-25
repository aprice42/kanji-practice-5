/* Confirms the generated files still match the content. Run with `npm run
   check` after adding cards, before `npm run build`.

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
  parseCards, parseSet, isFilled, duplicateReadings, isAllowedCollision,
  deckCharacters, isJapanese, isTraceable, GRADES,
} from './deck.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const problems = []
const fail = (headline, fix) => problems.push({ headline, fix })

/* 1. src/cards.js was built from the current content ---------------------- */

/* Re-derive what `npm run cards` would emit, by reading the same directories in
   the same order. The derivation is deliberately written out again here rather
   than imported from the generator: a check that shares the generator's idea of
   what a set is cannot catch the generator being wrong about it.

   GRADES is the exception, and is imported. Which files exist and what they are
   called is data, not derivation — and three hand-kept copies of it had already
   drifted apart, which is a worse failure than the one the duplication guards
   against. */

const listMd = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
    : []

const sources = []

for (const file of listMd('content/worksheets')) {
  const name = file.replace(/\.md$/, '')
  const parsed = parseCards(read(`content/worksheets/${file}`))
  const rows = parsed.groups.flatMap((g) => g.rows)
  sources.push({
    id: `w:${name}`,
    grade: null,
    rows: rows.filter(isFilled),
    words: rows.length,
    notes: parsed.groups.reduce((n, g) => n + g.notes.length, 0),
  })
}

for (const { file, set, grade } of GRADES) {
  if (!existsSync(join(root, 'content/words', file))) continue
  const parsed = parseCards(read(`content/words/${file}`))
  const rows = parsed.groups.flatMap((g) => g.rows)
  sources.push({
    id: set,
    grade,
    rows: rows.filter(isFilled),
    words: rows.length,
    notes: parsed.groups.reduce((n, g) => n + g.notes.length, 0),
  })
}

const { cards, SETS } = await import(new URL('../src/cards.js', import.meta.url))

/* One card per written form, membership collected as we go — the same rule the
   generator applies, arrived at independently. */
const expectedByForm = new Map()
for (const source of sources) {
  for (const [reading, written, meaning] of source.rows) {
    const card = expectedByForm.get(written)
    if (!card) {
      expectedByForm.set(written, { reading, written, meaning, sets: [source.id] })
      continue
    }
    if (card.reading !== reading || card.meaning !== meaning) {
      fail(
        `${written} is defined two different ways in content/.`,
        'Correct the transcription — the master list is canonical. `npm run cards` names both sources.'
      )
    }
    if (!card.sets.includes(source.id)) card.sets.push(source.id)
  }
}

const gradeOfForm = new Map()
for (const source of sources) {
  if (source.grade == null) continue
  for (const [, written] of source.rows) gradeOfForm.set(written, source.grade)
}

/* Referencing sets add membership but define nothing. Every form they name must
   resolve to a card, or the set silently practises fewer words than it says. */
const referencing = []
for (const file of listMd('content/sets')) {
  const name = file.replace(/\.md$/, '')
  const parsed = parseSet(read(`content/sets/${file}`))
  referencing.push({ id: `s:${name}`, file: `content/sets/${file}`, ...parsed })
  if (!parsed.title) {
    fail(`content/sets/${file} has no name.`, 'Give it a `# Heading` — it is what the picker shows.')
  }
  for (const form of parsed.forms) {
    const card = expectedByForm.get(form)
    if (!card) {
      fail(
        `content/sets/${file} lists ${form}, which no card defines.`,
        'Check the written form against content/words/ — they are exact, kana substitutions and all.'
      )
      continue
    }
    if (!card.sets.includes(`s:${name}`)) card.sets.push(`s:${name}`)
  }
}

const expected = [...expectedByForm.values()].map((c) => ({
  ...c,
  grade: gradeOfForm.get(c.written) ?? null,
}))

const same =
  expected.length === cards.length &&
  expected.every(
    (e, i) =>
      e.reading === cards[i].reading &&
      e.written === cards[i].written &&
      e.meaning === cards[i].meaning &&
      /* `grade` and `sets` are compared too. Without them a cards.js generated
         before sets existed passes every other check and the app silently
         plays one flat deck of everything. */
      e.grade === cards[i].grade &&
      String(e.sets) === String(cards[i].sets)
  )
if (!same) {
  fail(
    `src/cards.js does not match content/ (${cards.length} cards vs ${expected.length} rows).`,
    'npm run cards'
  )
}

/* A duplicate reading inside one set would let a round ask a question with two
   correct answers. Across sets it is the syllabus re-teaching a word, and is
   reported at the foot of this run. */
for (const set of [...sources, ...referencing]) {
  const members = expected.filter((c) => c.sets.includes(set.id))
  for (const collision of duplicateReadings(members.map((c) => [c.reading, c.written]))) {
    if (isAllowedCollision(collision)) continue
    fail(
      `${set.id} has two cards reading "${collision.reading}" — ${collision.forms.join(' and ')}.`,
      'Give one a different reading, or name it in ALLOWED_COLLISIONS in scripts/deck.mjs if the source really prints both.'
    )
  }
}

/* Every card's sets are in the manifest, and the manifest's counts are the ones
   the picker shows. Rolled up from the sources rather than read back from the
   manifest, so a generator that counts wrongly fails instead of agreeing with
   itself. */
if (!SETS) {
  fail('src/cards.js exports no SETS manifest.', 'npm run cards')
} else {
  const listed = new Map(SETS.map((s) => [s.id, s]))
  const named = [...new Set(cards.flatMap((c) => c.sets ?? []))]
  const unknown = named.filter((id) => !listed.has(id))
  if (unknown.length) {
    fail(`Cards name ${unknown.length} set(s) the manifest does not list: ${unknown.join(', ')}.`, 'npm run cards')
  }
  for (const set of [...sources, ...referencing]) {
    const entry = listed.get(set.id)
    if (!entry) {
      fail(`The SETS manifest is missing ${set.id}.`, 'npm run cards')
      continue
    }
    const members = expected.filter((c) => c.sets.includes(set.id))
    const words = set.words ?? members.length
    if (entry.cards !== members.length || entry.words !== words) {
      fail(`The SETS manifest miscounts ${set.id}.`, 'npm run cards')
    }
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
  console.log(`${cards.length} cards across ${SETS.length} sets, ${written.length} characters.`)
  console.log('cards.js matches content/; every character has stroke data and a glyph in the font subset.\n')

  /* Progress, not a verdict. A blank row is simply not a card yet, and a flag
     routes a reviewer's attention — neither is a failure, and making either one
     fail would leave the app unbuildable for as long as the content job runs. */
  for (const s of sources) {
    const b = s.words - s.rows.length
    if (!b && !s.notes) continue
    console.log(
      `  ${s.id.padEnd(18)} ${String(s.rows.length).padStart(3)} of ${String(s.words).padStart(3)} filled` +
        `${b ? `   ${b} blank` : ''}${s.notes ? `   ${s.notes} flagged` : ''}`
    )
  }
  if (blank || flagged) console.log(`\n  ${blank} row(s) still blank, ${flagged} flagged for review. Neither is a failure.`)

  const shared = cards.filter((c) => (c.sets ?? []).length > 1)
  if (shared.length) console.log(`  ${shared.length} card(s) belong to more than one set.`)

  const crossSet = duplicateReadings(cards.map((c) => [c.reading, c.written]))
  if (crossSet.length) {
    console.log(`  ${crossSet.length} reading(s) span more than one set — the syllabus re-teaching a word.`)
  }
  process.exit(0)
}

console.error(`${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`)
for (const { headline, fix } of problems) console.error(`  ${headline}\n    fix: ${fix}\n`)
process.exit(1)
