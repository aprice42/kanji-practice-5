/* Regenerates src/cards.js from the table in content/content.md.
   Run with `npm run cards` after editing that table.

   Transcribe the worksheet EXACTLY as printed, including places where it
   writes part of a word in kana because that kanji has not been taught yet
   (でん車, 全ぶ, 言ば, きょう力, りょう方, きゅう食, 分すう). Writing the full
   kanji form instead teaches him something his teacher is not asking for. */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCards, duplicateReading } from './deck.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const md = readFileSync(join(root, 'content/content.md'), 'utf8')

const { rows, stripped } = parseCards(md)

if (!rows.length) {
  console.error('No table rows found in content/content.md — nothing written.')
  process.exit(1)
}

const duplicate = duplicateReading(rows)
if (duplicate) {
  console.error(`Duplicate reading "${duplicate}" — every reading must be unique, or a`)
  console.error('multiple-choice question could have two correct answers. Nothing written.')
  process.exit(1)
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
console.log('Next: `npm run fonts` and `npm run strokes` (new characters need both subsets')
console.log('rebuilt), then `npm run check` and `npm run audit`.')
