/* Regenerates src/cards.js from the content under content/.
   Run with `npm run cards` after editing any of it.

   Three things define or name cards:

     content/words/*.md       the school's master kanji list, one file per
                              grade. Defines cards. Each file is one set.
     content/worksheets/*.md  a worksheet as the teacher sent it home. Defines
                              cards, and is also a set.
     content/sets/*.md        a hand-picked practice set. Defines nothing — it
                              lists written forms the files above already
                              define, and fails the build if one does not
                              resolve.

   Transcribe the source EXACTLY as printed, including places where it writes
   part of a word in kana because that kanji has not been taught yet (でん車,
   全ぶ, 言ば, きょう力, りょう方, きゅう食, 分すう). Writing the full kanji form
   instead teaches him something his teacher is not asking for.

   ONE CARD PER WRITTEN FORM. A word taught in grade 4 and also printed on the
   September worksheet is one card in two sets, not two cards. Membership lives
   on the card, as `sets`.

   Set LABELS stay English/ASCII on purpose. build-font-subset.mjs sweeps every
   double-quoted string in src/cards.js into the font subset, so a Japanese
   label would get a glyph only because it happens to land in this file — and a
   Japanese string living anywhere else silently falls back to a system face,
   which on some devices draws Chinese shapes. */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  parseCards, parseSet, isFilled, duplicateReadings, isAllowedCollision, GRADES, worksheetLabel,
} from './deck.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* A set is a named selection of cards: either a QUERY over card properties
   (`grade = 4`, which redefines itself when a new edition of the school's list
   is ingested) or an explicit LIST (a worksheet, a hand-picked practice set),
   which stays exactly what it was as the curriculum moves underneath it.

   Both are resolved here, at build time. The app never evaluates a query, and
   `npm run check` can therefore verify a set's real contents instead of
   reimplementing an evaluator. */
const SECTION = {
  curriculum: 'Curriculum',
  worksheet: 'Worksheets',
  set: 'Practice sets',
}

const markdownIn = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.md') && f !== 'README.md').sort()
    : []

const fail = (lines) => {
  console.error(`\n${lines.join('\n')}\n\nNothing written.`)
  process.exit(1)
}

/* ---------- the files that define cards ---------- */

/* Each is one set. Rows arrive as [reading, written, meaning]; blank ones are
   dropped here and counted, so a half-finished row simply is not a card yet and
   the build keeps working while the content job runs. */
const sources = []
let stripped = 0

for (const file of markdownIn('content/worksheets')) {
  const name = file.replace(/\.md$/, '')
  const parsed = parseCards(readFileSync(join(root, 'content/worksheets', file), 'utf8'))
  stripped += parsed.stripped
  const rows = parsed.groups.flatMap((g) => g.rows)
  sources.push({
    id: `w:${name}`,
    label: worksheetLabel(name),
    section: SECTION.worksheet,
    kind: 'list',
    grade: null,
    rows: rows.filter(isFilled),
    words: rows.length,
    notes: parsed.groups.reduce((n, g) => n + g.notes.length, 0),
    file: `content/worksheets/${file}`,
  })
}

for (const { file, set, label, grade } of GRADES) {
  const path = join(root, 'content/words', file)
  if (!existsSync(path)) continue
  const parsed = parseCards(readFileSync(path, 'utf8'))
  stripped += parsed.stripped
  /* Groups are flattened. A grade is one set — cutting it into quarters of the
     master list's print order never described anything real. */
  const rows = parsed.groups.flatMap((g) => g.rows)
  sources.push({
    id: set,
    label,
    section: SECTION.curriculum,
    kind: 'query',
    grade,
    rows: rows.filter(isFilled),
    words: rows.length,
    notes: parsed.groups.reduce((n, g) => n + g.notes.length, 0),
    file: `content/words/${file}`,
  })
}

if (!sources.length) fail(['No card sources found under content/.'])

/* ---------- one card per written form ---------- */

/* Two sources defining the same written form must agree about it. They do today
   — all 47 overlaps between the grades and the September worksheet are
   identical — so this is a guard rather than work. It matters because silently
   preferring one source is how a transcription defect disappears without anyone
   learning it was there. */
const byForm = new Map()
const disagreements = []

for (const source of sources) {
  for (const [reading, written, meaning] of source.rows) {
    const existing = byForm.get(written)
    if (!existing) {
      byForm.set(written, { reading, written, meaning, sets: [source.id], from: source.file })
      continue
    }
    if (existing.reading !== reading || existing.meaning !== meaning) {
      disagreements.push(
        `  ${written} is defined twice, differently:\n` +
          `    ${existing.from}  ${existing.reading} — ${existing.meaning}\n` +
          `    ${source.file}  ${reading} — ${meaning}`
      )
      continue
    }
    if (!existing.sets.includes(source.id)) existing.sets.push(source.id)
  }
}

if (disagreements.length) {
  fail([
    `${disagreements.length} written form(s) are defined two different ways:`,
    '',
    ...disagreements,
    '',
    'The master list is canonical. Correct the transcription rather than picking',
    'a side here — two forms that really are different words, like the sheet’s',
    'てん車 and the worksheet’s でん車, stay two separate cards and never reach this.',
  ])
}

const cards = [...byForm.values()]

/* The grade a written form belongs to, learned from the curriculum. Worksheet
   cards get it by lookup, which matters beyond tidiness: the app widens a small
   selection's distractor pool to the card's grade. A teacher-composed form the
   master list has never heard of — 鳥, 休み, 北と南, でん車 — keeps a null grade,
   which is the honest answer. */
const gradeOfForm = new Map()
for (const source of sources) {
  if (source.grade == null) continue
  for (const [, written] of source.rows) gradeOfForm.set(written, source.grade)
}
for (const card of cards) card.grade = gradeOfForm.get(card.written) ?? null

/* ---------- sets that only reference cards ---------- */

const referencing = []
for (const file of markdownIn('content/sets')) {
  const name = file.replace(/\.md$/, '')
  const parsed = parseSet(readFileSync(join(root, 'content/sets', file), 'utf8'))
  referencing.push({
    id: `s:${name}`,
    label: parsed.title,
    section: SECTION.set,
    kind: 'list',
    forms: parsed.forms,
    file: `content/sets/${file}`,
  })
}

const setProblems = []
for (const set of referencing) {
  if (!set.forms.length) setProblems.push(`  ${set.file} lists no words.`)
  // No filename fallback: the heading is what the picker shows, and deriving
  // "Week 3 Test" from a filename is worse than being asked for it.
  if (!set.label) setProblems.push(`  ${set.file} has no name — give it a \`# Heading\`.`)

  const seen = new Set()
  for (const form of set.forms) {
    if (seen.has(form)) {
      setProblems.push(`  ${set.file} lists ${form} twice.`)
      continue
    }
    seen.add(form)
    const card = byForm.get(form)
    if (!card) {
      setProblems.push(
        `  ${set.file} lists ${form}, which no card defines.\n` +
          `    The written forms are exact, kana substitutions and all — check it` +
          ` against content/words/.`
      )
      continue
    }
    card.sets.push(set.id)
  }
}

if (setProblems.length) fail([`${setProblems.length} problem(s) in content/sets/:`, '', ...setProblems])

/* ---------- the manifest ---------- */

const sets = [...sources, ...referencing].map((s) => ({
  id: s.id,
  label: s.label,
  section: s.section,
  kind: s.kind,
}))
for (const set of sets) {
  const members = cards.filter((c) => c.sets.includes(set.id))
  set.cards = members.length
  // `words` counts the rows a set covers, blanks included — progress through
  // the content job. A referencing set has no rows of its own to be blank.
  set.words = sources.find((s) => s.id === set.id)?.words ?? members.length
}

/* A duplicate reading inside one set would let a single round ask a question
   with two correct answers. Across sets it is the syllabus re-teaching a word
   as more of its kanji arrive — じどう車 → 自どう車 → 自動車 — and is only
   reported. */
const collisions = []
for (const set of sets) {
  const members = cards.filter((c) => c.sets.includes(set.id))
  for (const collision of duplicateReadings(members.map((c) => [c.reading, c.written]))) {
    if (isAllowedCollision(collision)) continue
    collisions.push(
      `  ${set.id} has two cards reading "${collision.reading}" — ${collision.forms.join(' and ')}.\n` +
        `    A round drawing both would ask a question with two correct answers.`
    )
  }
}
if (collisions.length) {
  fail([`${collisions.length} duplicate reading(s) inside a single set:`, '', ...collisions])
}

/* ---------- write ---------- */

const json = (v) => JSON.stringify(v)

const cardBody = cards
  .map(
    (c) =>
      `  { reading: ${json(c.reading)}, written: ${json(c.written)}, meaning: ${json(c.meaning)}, ` +
      `grade: ${json(c.grade)}, sets: ${json(c.sets)} },`
  )
  .join('\n')

const setBody = sets
  .map(
    (s) =>
      `  { id: ${json(s.id)}, label: ${json(s.label)}, section: ${json(s.section)}, ` +
      `kind: ${json(s.kind)}, cards: ${s.cards}, words: ${s.words} },`
  )
  .join('\n')

writeFileSync(
  join(root, 'src/cards.js'),
  `// Generated by \`npm run cards\` from content/ — do not edit by hand.\n` +
    `// ${cards.length} cards across ${sets.length} sets.\n\n` +
    `// Every set, for the picker. \`cards\` counts the rows that are filled in\n` +
    `// and playable; \`words\` counts every row the set covers, so progress\n` +
    `// through the content job stays visible. A \`query\` set is defined by a\n` +
    `// card property and redefines itself when the master list changes; a\n` +
    `// \`list\` set is an explicit list of words and does not.\n` +
    `export const SETS = [\n${setBody}\n]\n\n` +
    `// One card per written form. \`sets\` is every set it belongs to.\n` +
    `export const cards = [\n${cardBody}\n]\n`,
  'utf8'
)

/* ---------- report ---------- */

console.log(`\nWrote src/cards.js — ${cards.length} cards across ${sets.length} sets.\n`)
for (const set of sets) {
  const source = sources.find((s) => s.id === set.id)
  const blank = source ? source.words - source.rows.length : 0
  console.log(
    `  ${set.id.padEnd(18)} ${set.label.padEnd(20)} ${String(set.cards).padStart(3)} cards` +
      `${blank ? `   ${blank} blank` : ''}${source?.notes ? `   ${source.notes} flagged` : ''}`
  )
}

const shared = cards.filter((c) => c.sets.length > 1)
if (shared.length) console.log(`\n  ${shared.length} card(s) belong to more than one set.`)

const crossSet = duplicateReadings(cards.map((c) => [c.reading, c.written]))
if (crossSet.length) {
  console.log(
    `  ${crossSet.length} reading(s) span more than one set, covering ` +
      `${crossSet.reduce((n, c) => n + c.forms.length, 0)} cards.`
  )
  console.log('  That is the syllabus: a word is re-taught as more of its kanji arrive.')
  console.log('  Harmless — a round draws from one selection, and src/choices.js refuses')
  console.log('  a distractor whose prompt face matches the question being asked.')
}

if (stripped) console.log(`\n  Dropped 〔…〕 reference notes from ${stripped} written form(s).`)
console.log('\nNext: `npm run fonts` and `npm run strokes` (new characters need both subsets')
console.log('rebuilt), then `npm run check` and `npm run audit`.\n')
