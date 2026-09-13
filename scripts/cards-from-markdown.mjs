/* Regenerates src/cards.js from the table in content/content.md.
   Run with `npm run cards` after editing that table.

   Transcribe the worksheet EXACTLY as printed, including places where it
   writes part of a word in kana because that kanji has not been taught yet
   (でん車, 全ぶ, 言ば, きょう力, りょう方, きゅう食, 分すう). Writing the full
   kanji form instead teaches him something his teacher is not asking for. */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = readFileSync(join(root, 'content/content.md'), 'utf8')

const rows = []
for (const line of md.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) continue
  const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  if (cells.length !== 3) continue
  if (cells[0].startsWith('Reading')) continue // header
  if (/^[-\s]+$/.test(cells[0])) continue // separator
  rows.push(cells)
}

if (!rows.length) {
  console.error('No table rows found in content/content.md — nothing written.')
  process.exit(1)
}

/* content.md keeps the full kanji form as a note in 〔…〕 — 全ぶ〔全部〕 — which
   is useful reference but is NOT what the worksheet asks him to write. Strip it
   so the cards show exactly the worksheet's form. */
let stripped = 0
for (const row of rows) {
  const bare = row[1].replace(/〔.*?〕/g, '').trim()
  if (bare !== row[1]) stripped++
  row[1] = bare
}

const seen = new Map()
for (const [reading, written] of rows) {
  if (seen.has(reading)) {
    console.error(`Duplicate reading "${reading}" — every reading must be unique, or a`)
    console.error('multiple-choice question could have two correct answers. Nothing written.')
    process.exit(1)
  }
  seen.set(reading, written)
}

const body = rows
  .map(([r, w, m]) => `  { reading: ${JSON.stringify(r)}, written: ${JSON.stringify(w)}, meaning: ${JSON.stringify(m)} },`)
  .join('\n')

writeFileSync(
  join(root, 'src/cards.js'),
  `// Generated from content/content.md by \`npm run cards\` — do not edit by hand.\n` +
    `// ${rows.length} items.\nexport const cards = [\n${body}\n]\n`,
  'utf8'
)

console.log(`Wrote src/cards.js with ${rows.length} cards.`)
if (stripped) console.log(`Dropped 〔…〕 reference notes from ${stripped} written form(s).`)
console.log('Next: `npm run fonts` (new kanji need the font subset rebuilt), then `npm run audit`.')
