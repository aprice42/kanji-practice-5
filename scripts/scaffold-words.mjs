/* Generates one Markdown file per grade from the school's master kanji list.

   The master list gives every word the school teaches and the grade it belongs
   to, but no readings and no English meanings — those are written by hand. This
   script lays out the rows to fill in and, crucially, is safe to re-run: it
   merges on the written form, so nothing hand-written is ever overwritten, no
   matter how the list is renumbered or regrouped underneath it.

   That merge is the whole point. The `No` column in the master list is gapless
   within an edition but is not an identity key across editions — a new sheet
   that inserts one kanji renumbers every row after it. The written form cannot
   renumber, so it is what rows are matched on. */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* Grades, in the order the sheet prints them. `ch` is the sixth tier the sheet
   lists past grade 5 — not "grade 6", which would claim something the sheet
   does not say. */
const GRADES = [
  { id: 1, file: 'grade-1.md', title: 'Kanji Grade 1' },
  { id: 2, file: 'grade-2.md', title: 'Kanji Grade 2' },
  { id: 3, file: 'grade-3.md', title: 'Kanji Grade 3' },
  { id: 4, file: 'grade-4.md', title: 'Kanji Grade 4' },
  { id: 5, file: 'grade-5.md', title: 'Kanji Grade 5' },
  { id: 'ch', file: 'challenge.md', title: 'Challenge' },
]

const GROUPS = 4
const WORDS_DIR = join(root, 'content/words')

/* ---------- read the active edition ---------- */

function activeEdition() {
  const pointer = join(root, 'content/kanji-list/current')
  if (!existsSync(pointer)) {
    fail(`No edition selected.\n  fix: write an edition name into content/kanji-list/current`)
  }
  const name = readFileSync(pointer, 'utf8').trim()
  const list = join(root, 'content/kanji-list', name, 'list.json')
  if (!existsSync(list)) {
    fail(`content/kanji-list/current names "${name}", but ${list} does not exist.`)
  }
  return { name, data: JSON.parse(readFileSync(list, 'utf8')) }
}

/* ---------- derive the word list ---------- */

/* One entry per distinct written form. Order is the sheet's own: by the `no` of
   the kanji hosting the word, then the order that kanji lists its words. A word
   hosted under several kanji (外国語 sits under 外, 国 and 語) takes its earliest
   host, so it appears once, at its first mention. */
function wordsFrom(list) {
  const seen = new Map()
  const conflicts = []

  for (const entry of [...list.kanji].sort((a, b) => a.no - b.no)) {
    entry.usage.forEach((use, i) => {
      // The sheet's own `(N)` tag says when the word is taught; without one the
      // word is taught with the kanji hosting it.
      const grade = use.g ?? entry.grade
      const existing = seen.get(use.w)
      if (existing) {
        if (existing.grade !== grade) conflicts.push({ word: use.w, a: existing.grade, b: grade })
        return
      }
      seen.set(use.w, { written: use.w, grade, no: entry.no, seq: i })
    })
  }

  // Verified zero on the 2022 edition. If a later edition disagrees with itself
  // the grouping is guesswork, so say so rather than pick a side silently.
  if (conflicts.length) {
    fail(
      `${conflicts.length} word(s) are assigned two different grades by the master list:\n` +
        conflicts.map((c) => `  ${c.word}: grade ${c.a} and grade ${c.b}`).join('\n')
    )
  }

  return [...seen.values()].sort((a, b) => a.no - b.no || a.seq - b.seq)
}

/* Cut a grade's words into four near-equal groups, in order. The extra words
   when it does not divide evenly go to the earliest groups. */
function intoGroups(words) {
  const base = Math.floor(words.length / GROUPS)
  const extra = words.length % GROUPS
  const out = []
  let at = 0
  for (let i = 0; i < GROUPS; i++) {
    const size = base + (i < extra ? 1 : 0)
    out.push(words.slice(at, at + size))
    at += size
  }
  return out
}

/* ---------- read what has already been written by hand ---------- */

/* Rows are matched on the written form alone, so a row keeps its reading and
   meaning even if the word moved grade, moved group, or was renumbered. */
function parseTable(md) {
  const rows = new Map()
  for (const line of md.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    if (cells.length < 3 || cells.length > 4) continue
    if (cells[0].startsWith('Reading')) continue // header
    if (/^[-\s]+$/.test(cells[0])) continue // separator
    const [reading, written, meaning, note = ''] = cells
    if (!written) continue
    rows.set(written, { reading, meaning, note })
  }
  return rows
}

function existingRows() {
  const rows = new Map()
  if (!existsSync(WORDS_DIR)) return rows
  for (const file of readdirSync(WORDS_DIR).filter((f) => f.endsWith('.md'))) {
    if (file === 'README.md') continue
    for (const [written, row] of parseTable(readFileSync(join(WORDS_DIR, file), 'utf8'))) {
      rows.set(written, row)
    }
  }
  return rows
}

/* The 51-card September worksheet already answers 47 of these words. Seeding
   from it saves that work and, more importantly, sets the house voice for the
   meanings — plain English a ten-year-old would use. */
function seedRows() {
  const rows = new Map()
  const path = join(root, 'content/worksheets/2025-09-review.md')
  if (!existsSync(path)) return rows
  for (const [written, row] of parseTable(readFileSync(path, 'utf8'))) {
    // 〔…〕 carries the full-kanji reference form and never reaches the app.
    rows.set(written.replace(/〔.*?〕/g, '').trim(), row)
  }
  return rows
}

/* ---------- emit ---------- */

function table(rows) {
  const header = ['Reading (かな)', 'Written form', 'Meaning', 'Check?']
  const body = rows.map((r) => [r.reading, r.written, r.meaning, r.note])
  const width = header.map((h, i) =>
    Math.max([...h].length, ...body.map((r) => [...(r[i] ?? '')].length))
  )
  const pad = (s, i) => s + ' '.repeat(Math.max(0, width[i] - [...s].length))
  const line = (cells) => `| ${cells.map(pad).join(' | ')} |`
  return [
    line(header),
    `| ${width.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...body.map(line),
  ].join('\n')
}

function render(grade, groups) {
  const out = [
    `# ${grade.title}`,
    '',
    '<!-- Generated by `npm run scaffold` from the master kanji list.',
    '',
    '     The Written form column is the master list and is NOT yours to edit —',
    '     it is copied exactly as the school prints it, kana substitutions and',
    '     all. Fill in Reading and Meaning. Use Check? to flag anything you',
    '     inferred rather than read.',
    '',
    '     Re-running this script preserves every cell you have filled in.',
    '     See content/words/README.md before starting. -->',
    '',
  ]
  groups.forEach((rows, i) => {
    out.push(`## Group ${i + 1}`, '')
    out.push(rows.length ? table(rows) : '_No words in this group._')
    out.push('')
  })
  return out.join('\n')
}

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

/* ---------- run ---------- */

const { name: edition, data: list } = activeEdition()
const words = wordsFrom(list)
const existing = existingRows()
const seeds = seedRows()

// Hand-written rows win over the seed, so a correction made in content/words/
// is never reverted by content.md on the next run.
const known = new Map([...seeds, ...existing])

mkdirSync(WORDS_DIR, { recursive: true })

let filled = 0
let flagged = 0
let fromSeed = 0
const perGrade = []
const written = new Set()

for (const grade of GRADES) {
  const mine = words.filter((w) => w.grade === grade.id)
  const groups = intoGroups(mine).map((group) =>
    group.map((w) => {
      const prior = known.get(w.written)
      if (prior?.reading && prior?.meaning) {
        filled++
        if (!existing.has(w.written)) fromSeed++
      }
      if (prior?.note) flagged++
      written.add(w.written)
      return {
        written: w.written,
        reading: prior?.reading ?? '',
        meaning: prior?.meaning ?? '',
        note: prior?.note ?? '',
      }
    })
  )
  writeFileSync(join(WORDS_DIR, grade.file), render(grade, groups), 'utf8')
  perGrade.push({ grade, total: mine.length, sizes: groups.map((g) => g.length) })
}

/* A hand-written row whose word is no longer in the master list must not just
   vanish — that is the one thing this script could destroy and could not undo.
   It is parked instead, and a later edition that brings the word back picks its
   reading and meaning up again for free. */
const orphans = [...existing].filter(
  ([word, row]) => !written.has(word) && (row.reading || row.meaning)
)
if (orphans.length) {
  const rows = orphans.map(([word, row]) => ({ written: word, ...row }))
  writeFileSync(
    join(WORDS_DIR, 'retired.md'),
    [
      '# Retired words',
      '',
      '<!-- Words that were filled in by hand but are no longer in the master',
      '     kanji list. Kept, not deleted: if a later edition brings one back,',
      '     `npm run scaffold` picks its reading and meaning up from here. -->',
      '',
      table(rows),
      '',
    ].join('\n'),
    'utf8'
  )
}

/* ---------- report ---------- */

const total = words.length
console.log(`\nEdition ${edition} — ${list.kanji.length} kanji, ${total} distinct words.\n`)
for (const { grade, total: n, sizes } of perGrade) {
  console.log(`  ${grade.title.padEnd(14)} ${String(n).padStart(3)} words   groups ${sizes.join(' / ')}`)
}
console.log(`\n  ${filled} of ${total} rows filled${fromSeed ? ` (${fromSeed} seeded from the September worksheet)` : ''}`)
console.log(`  ${total - filled} still blank, ${flagged} flagged for review`)
if (orphans.length) console.log(`  ${orphans.length} row(s) no longer in the list — parked in content/words/retired.md`)
console.log(`\nWrote ${GRADES.length} files to content/words/.`)
console.log(`Next: fill in Reading and Meaning. See content/words/README.md.\n`)
