/* Regenerates src/cards.js from every deck under content/.
   Run with `npm run cards` after editing any of them.

   Two kinds of deck feed this:

     content/worksheets/*.md   a worksheet as the teacher sent it home — one
                               deck, no groups
     content/words/*.md        a grade of the school's master kanji list, cut
                               into four `## Group N` sections by the scaffold

   Transcribe the source EXACTLY as printed, including places where it writes
   part of a word in kana because that kanji has not been taught yet (でん車,
   全ぶ, 言ば, きょう力, りょう方, きゅう食, 分すう). Writing the full kanji form
   instead teaches him something his teacher is not asking for.

   Two things this emits that the single-deck version did not:

   - a `deck` field on every card, so a round can draw from a subset;
   - a DECKS manifest carrying each deck's label and counts, so the UI never has
     to derive a label by string-splitting an id.

   Deck LABELS stay English/ASCII on purpose. build-font-subset.mjs sweeps every
   double-quoted string in src/cards.js into the font subset, so a Japanese
   label would get a glyph only because it happens to land in this file — and a
   Japanese string living anywhere else silently falls back to a system face,
   which on some devices draws Chinese shapes. */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseCards, isFilled, duplicateReadings, isAllowedCollision, GRADES, worksheetLabel,
} from './deck.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------- sets, emitted alongside decks ----------

   A set is a named selection of cards: either a QUERY over card properties
   (`grade = 4`, which redefines itself when a new edition of the school's list
   is ingested) or an explicit LIST (a worksheet, which stays exactly what the
   teacher sent home even as the curriculum moves underneath it).

   Both are resolved here, at build time. The app never evaluates a query, and
   `npm run check` can therefore verify a set's real contents instead of
   reimplementing an evaluator.

   Nothing reads `sets` or `SETS` yet — the app is still on decks, and every
   deck maps to exactly one set for now. Grade sets are whole grades: the four
   `g4:N` decks all belong to set `g4`. */

const SECTION = { curriculum: 'Curriculum', worksheet: 'Worksheets' }

const decks = []
const problems = []
let stripped = 0

const add = (deck) => {
  /* Fatal within a deck: two cards a single round can both draw would make a
     multiple-choice question with two correct answers. Across decks it is the
     curriculum working as designed and is only reported. */
  for (const collision of duplicateReadings(deck.rows)) {
    if (isAllowedCollision(collision)) continue
    problems.push(
      `${deck.id} has two cards reading "${collision.reading}" — ${collision.forms.join(' and ')}.\n` +
        `    A round drawing both would ask a question with two correct answers.`
    )
  }
  decks.push(deck)
}

/* ---------- worksheets ---------- */

const worksheetDir = join(root, 'content/worksheets')
for (const file of existsSync(worksheetDir) ? readdirSync(worksheetDir).sort() : []) {
  if (!file.endsWith('.md') || file === 'README.md') continue
  const name = file.replace(/\.md$/, '')
  const parsed = parseCards(readFileSync(join(worksheetDir, file), 'utf8'))
  stripped += parsed.stripped
  const rows = parsed.groups.flatMap((g) => g.rows)
  add({
    id: `w:${name}`,
    label: worksheetLabel(name),
    grade: null,
    group: null,
    set: `w:${name}`,
    setLabel: worksheetLabel(name),
    section: SECTION.worksheet,
    kind: 'list',
    rows: rows.filter(isFilled),
    words: rows.length,
    notes: parsed.groups.reduce((n, g) => n + g.notes.length, 0),
  })
}

/* ---------- grade worksheets, one deck per group ---------- */

const wordsDir = join(root, 'content/words')
for (const { file, prefix, label, grade, set } of GRADES) {
  const path = join(wordsDir, file)
  if (!existsSync(path)) continue
  const parsed = parseCards(readFileSync(path, 'utf8'))
  stripped += parsed.stripped
  parsed.groups.forEach((group, i) => {
    add({
      id: `${prefix}:${i + 1}`,
      label: `${label} · Group ${i + 1}`,
      grade,
      group: i + 1,
      set,
      setLabel: label,
      section: SECTION.curriculum,
      kind: 'query',
      rows: group.rows.filter(isFilled),
      words: group.rows.length,
      notes: group.notes.length,
    })
  })
}

/* ---------- write ---------- */

if (!decks.length) {
  console.error('No decks found under content/ — nothing written.')
  process.exit(1)
}

if (problems.length) {
  console.error(`\n${problems.length} duplicate reading(s) inside a single deck:\n`)
  for (const p of problems) console.error(`  ${p}\n`)
  console.error('Nothing written.')
  process.exit(1)
}

/* Roll the decks up into sets. Every deck belongs to exactly one, so this is a
   grouping rather than a re-derivation — the four g4:N decks become set g4. */
const sets = []
const setById = new Map()
for (const deck of decks) {
  let set = setById.get(deck.set)
  if (!set) {
    set = { id: deck.set, label: deck.setLabel, section: deck.section, kind: deck.kind, cards: 0, words: 0 }
    setById.set(deck.set, set)
    sets.push(set)
  }
  set.cards += deck.rows.length
  set.words += deck.words
}

/* The grade a written form belongs to, learned from the curriculum. Worksheet
   cards get it by lookup, which matters for more than tidiness: the app widens
   a small selection's distractor pool to the card's grade, and a worksheet card
   with no grade silently loses that widening. A teacher-composed form the
   master list has never heard of — 鳥, 休み, 北と南, でん車 — keeps a null grade,
   which is the honest answer. */
const gradeOfForm = new Map()
for (const deck of decks) {
  if (deck.grade == null) continue
  for (const [, written] of deck.rows) gradeOfForm.set(written, deck.grade)
}

const json = (v) => JSON.stringify(v)
const cardBody = decks
  .flatMap((deck) =>
    deck.rows.map(([r, w, m]) => {
      const grade = deck.grade ?? gradeOfForm.get(w) ?? null
      return (
        `  { reading: ${json(r)}, written: ${json(w)}, meaning: ${json(m)}, ` +
        `deck: ${json(deck.id)}, grade: ${json(grade)}, sets: ${json([deck.set])} },`
      )
    })
  )
  .join('\n')

const setBody = sets
  .map(
    (s) =>
      `  { id: ${json(s.id)}, label: ${json(s.label)}, section: ${json(s.section)}, ` +
      `kind: ${json(s.kind)}, cards: ${s.cards}, words: ${s.words} },`
  )
  .join('\n')

const deckBody = decks
  .map(
    (d) =>
      `  { id: ${json(d.id)}, label: ${json(d.label)}, grade: ${json(d.grade)}, ` +
      `group: ${json(d.group)}, cards: ${d.rows.length}, words: ${d.words} },`
  )
  .join('\n')

const total = decks.reduce((n, d) => n + d.rows.length, 0)

writeFileSync(
  join(root, 'src/cards.js'),
  `// Generated by \`npm run cards\` from content/worksheets/ and content/words/ —\n` +
    `// do not edit by hand.\n` +
    `// ${total} cards across ${sets.length} sets.\n\n` +
    `// Every set, for the picker. \`cards\` counts the rows that are filled in\n` +
    `// and playable; \`words\` counts every row the set covers, so progress\n` +
    `// through the content job stays visible. A \`query\` set is defined by a\n` +
    `// card property and redefines itself when the master list changes; a\n` +
    `// \`list\` set is an explicit list of words and does not.\n` +
    `export const SETS = [\n${setBody}\n]\n\n` +
    `// Decks — the older, finer-grained split, still what the app reads.\n` +
    `// Superseded by SETS; removed once the app is moved over.\n` +
    `export const DECKS = [\n${deckBody}\n]\n\n` +
    `export const cards = [\n${cardBody}\n]\n`,
  'utf8'
)

/* ---------- report ---------- */

console.log(`\nWrote src/cards.js — ${total} cards across ${decks.length} decks.\n`)
for (const d of decks) {
  const blank = d.words - d.rows.length
  console.log(
    `  ${d.id.padEnd(16)} ${d.label.padEnd(22)} ${String(d.rows.length).padStart(3)} of ${String(d.words).padStart(3)}` +
      `${blank ? `   ${blank} blank` : ''}${d.notes ? `   ${d.notes} flagged` : ''}`
  )
}

const crossDeck = duplicateReadings(decks.flatMap((d) => d.rows))
if (crossDeck.length) {
  console.log(
    `\n  ${crossDeck.length} reading(s) appear in more than one deck, covering ` +
      `${crossDeck.reduce((n, c) => n + c.forms.length, 0)} cards.`
  )
  console.log('  That is the syllabus: a word is re-taught as more of its kanji arrive.')
  console.log('  Harmless — a round draws from one selection, and src/choices.js refuses')
  console.log('  a distractor whose prompt face matches the question being asked.')
}

if (stripped) console.log(`\n  Dropped 〔…〕 reference notes from ${stripped} written form(s).`)
console.log('\nNext: `npm run fonts` and `npm run strokes` (new characters need both subsets')
console.log('rebuilt), then `npm run check` and `npm run audit`.\n')
