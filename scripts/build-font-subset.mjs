/* Rebuilds the Klee One subset in public/fonts/ from whatever characters
   src/cards.js currently uses. Run with `npm run fonts` after adding cards.

   Why this matters: the bundled font contains ONLY the characters the cards
   need, to keep it ~50 KB per weight instead of megabytes. A kanji that is not
   in the subset falls back to a system font — and on some devices that
   fallback is a Chinese face, which draws characters like 言 with the wrong
   shape. Skipping this step after adding cards reintroduces that bug for the
   new characters only, which is easy to miss.

   Needs network access. Klee One is OFL-licensed (public/fonts/OFL.txt). */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const WEIGHTS = [400, 600]
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const src = readFileSync(join(root, 'src/cards.js'), 'utf8')
const strings = [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1])
const cardChars = new Set(strings.join(''))
// Basic Latin too, so the face can carry the odd Roman character in a card.
for (let c = 0x20; c < 0x7f; c++) cardChars.add(String.fromCharCode(c))

const text = [...cardChars].sort().join('')
const jpCount = [...cardChars].filter((c) => c.codePointAt(0) > 0x2e80).length
console.log(`${jpCount} Japanese characters across the deck; requesting ${text.length} glyphs.`)

const cssUrl =
  `https://fonts.googleapis.com/css2?family=Klee+One:wght@${WEIGHTS.join(';')}` +
  `&text=${encodeURIComponent(text)}`

const css = await fetch(cssUrl, { headers: { 'User-Agent': UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts returned ${r.status}`)
  return r.text()
})

const urls = [...css.matchAll(/src:\s*url\((https[^)]+)\)/g)].map((m) => m[1])
if (urls.length !== WEIGHTS.length) {
  throw new Error(`Expected ${WEIGHTS.length} font URLs, got ${urls.length}. CSS:\n${css}`)
}

for (const [i, weight] of WEIGHTS.entries()) {
  const buf = Buffer.from(await fetch(urls[i], { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()))
  if (buf.subarray(0, 4).toString() !== 'wOF2') {
    throw new Error(`Weight ${weight} did not come back as woff2 — aborting rather than writing a bad file.`)
  }
  const out = join(root, `public/fonts/klee-one-${weight}.woff2`)
  writeFileSync(out, buf)
  console.log(`  klee-one-${weight}.woff2  ${(buf.length / 1024).toFixed(1)} KB`)
}

console.log('Done. Rebuild (`npm run build`) so the service worker precaches the new files.')
