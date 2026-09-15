/* Confirms the generated files still match the deck. Run with `npm run check`
   after adding cards, before `npm run build`.

   Every generator here validates its own output, but nothing used to check that
   the outputs were built from the CURRENT content.md. Adding cards and
   forgetting a step leaves a tree where everything "succeeds" and the app is
   quietly wrong — a new kanji renders in a Chinese fallback face, or cannot be
   traced at all. Both failure modes are documented in README.md, and being
   documented is what already failed: the font one shipped.

   So this is the check that makes those steps hard to skip rather than merely
   written down. It regenerates nothing and writes nothing. */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseCards, duplicateReading, deckCharacters, isJapanese } from './deck.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const problems = []
const fail = (headline, fix) => problems.push({ headline, fix })

/* 1. src/cards.js was built from the current content.md ------------------- */

const { rows } = parseCards(read('content/content.md'))
const { cards } = await import(new URL('../src/cards.js', import.meta.url))

const duplicate = duplicateReading(rows)
if (duplicate) fail(`content.md has two cards reading "${duplicate}".`, 'Give one of them a different reading.')

const expected = rows.map(([reading, written, meaning]) => ({ reading, written, meaning }))
const same =
  expected.length === cards.length &&
  expected.every((e, i) => e.reading === cards[i].reading && e.written === cards[i].written && e.meaning === cards[i].meaning)
if (!same) {
  fail(
    `src/cards.js does not match content/content.md (${cards.length} cards vs ${expected.length} rows).`,
    'npm run cards'
  )
}

/* 2. Every character has stroke data --------------------------------------- */

const { strokes } = await import(new URL('../src/strokes.js', import.meta.url))
const written = [...new Set(cards.flatMap((c) => [...c.written]))]
const noStrokes = written.filter((ch) => !strokes[ch])
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

if (!problems.length) {
  console.log(`${cards.length} cards, ${written.length} characters.`)
  console.log('cards.js matches content.md; every character has stroke data and a glyph in the font subset.')
  process.exit(0)
}

console.error(`${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`)
for (const { headline, fix } of problems) console.error(`  ${headline}\n    fix: ${fix}\n`)
process.exit(1)
