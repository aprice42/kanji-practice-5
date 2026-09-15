/* Rebuilds src/strokes.js from whatever characters src/cards.js currently uses.
   Run with `npm run strokes` after adding cards.

   Stroke data comes from KanjiVG, one SVG per character, each <path> being one
   stroke in stroke order. The full repository is megabytes; this keeps only the
   characters the deck actually needs, the same trick build-font-subset.mjs uses
   for the typeface. A character added to the deck without rerunning this has no
   stroke data, and Trace mode has to skip it.

   Needs network access. KanjiVG is CC BY-SA 3.0 — see public/KANJIVG-LICENSE.txt.
   That is share-alike, unlike the font's OFL: src/strokes.js is a derived work
   and carries the same licence. */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://raw.githubusercontent.com/KanjiVG/kanjivg/master/kanji'
const VIEWBOX = 109

/* Only the written forms are ever traced, so unlike the font script — which needs
   the readings and meanings too — this reads just the `written` field. */
const src = readFileSync(join(root, 'src/cards.js'), 'utf8')
const written = [...new Set([...src.matchAll(/written: "([^"]*)"/g)].flatMap((m) => [...m[1]]))]

console.log(`${written.length} characters across the deck's written forms.`)

/* KanjiVG names files by zero-padded five-digit lowercase hex codepoint. */
const fileFor = (ch) => ch.codePointAt(0).toString(16).padStart(5, '0')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* Coordinates carry two decimals; one is well inside the precision anyone can
   trace at, and it takes about a fifth off the file.

   Rounding a path is not a search and replace. In SVG path data a minus sign is
   also a separator — `0.8-0.05` is two numbers, not one — so any negative that
   rounds to zero loses the sign that was holding it apart from its neighbour,
   and `0.8-0.05` silently becomes the single number `0.80`. That shipped: it
   corrupted 48 strokes across 25 characters, and a corrupted stroke cannot be
   traced correctly, so the app rejected every attempt at it forever.

   So the numbers are tokenised and re-emitted with an explicit comma wherever
   the next one does not begin with a minus and delimit itself. KanjiVG uses
   only M/C/c/S/s/L/l and z — no arcs — so there are no flag arguments whose
   meaning depends on position. */
const NUM = /-?(?:\d+\.\d+|\.\d+|\d+)/g

function trim(d) {
  return (d.match(/[A-Za-z][^A-Za-z]*/g) || [])
    .map((segment) => {
      const command = segment[0]
      const numbers = (segment.slice(1).match(NUM) || []).map((n) => {
        const rounded = Math.round(Number(n) * 10) / 10
        // Object.is catches -0, whose String() is "0" and drops the sign.
        return String(Object.is(rounded, -0) ? 0 : rounded)
      })
      let out = command
      numbers.forEach((n, i) => {
        if (i > 0 && !n.startsWith('-')) out += ','
        out += n
      })
      return out
    })
    .join('')
}

/* How many numbers each command takes. Checked after rounding, because the
   whole point is that rounding can change how many numbers a path parses as. */
const ARITY = { M: 2, m: 2, L: 2, l: 2, C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2, H: 1, h: 1, V: 1, v: 1, Z: 0, z: 0 }

function validate(ch, index, d) {
  for (const segment of d.match(/[A-Za-z][^A-Za-z]*/g) || []) {
    const command = segment[0]
    const arity = ARITY[command]
    if (arity === undefined) throw new Error(`${ch} stroke ${index + 1}: unknown command ${command}`)
    const count = (segment.slice(1).match(NUM) || []).length
    if (arity === 0 ? count > 0 : count % arity !== 0) {
      throw new Error(`${ch} stroke ${index + 1}: ${command} takes ${arity} numbers, got ${count} — ${d}`)
    }
  }
}

const out = {}
const missing = []
let strokeCount = 0

for (const ch of written) {
  const name = fileFor(ch)
  const res = await fetch(`${BASE}/${name}.svg`)
  if (!res.ok) {
    if (res.status === 404) {
      missing.push(ch)
      console.warn(`  ${ch} (${name}) — not in KanjiVG, skipping`)
      continue
    }
    throw new Error(`${ch} (${name}) returned ${res.status}`)
  }
  const svg = await res.text()

  /* Document order is stroke order — that is the whole reason this data is
     usable. The <text> layer of stroke numbers has no d attribute, so matching
     on <path> alone already excludes it. */
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => trim(m[1]))
  if (!paths.length) throw new Error(`${ch} (${name}) parsed to zero strokes`)

  paths.forEach((d, i) => validate(ch, i, d))

  out[ch] = paths
  strokeCount += paths.length
  await sleep(50) // polite to raw.githubusercontent
}

const header = `/* Generated from KanjiVG by \`npm run strokes\` — do not edit by hand.
   ${Object.keys(out).length} characters, ${strokeCount} strokes.

   Stroke data from KanjiVG <http://kanjivg.tagaini.net>,
   Copyright (C) 2009-2024 Ulrich Apel and contributors.
   Licensed under Creative Commons Attribution-Share Alike 3.0.
   This file is a derived work and carries the same licence.
   See public/KANJIVG-LICENSE.txt. */`

const body = Object.entries(out)
  .map(([ch, paths]) => `  "${ch}": [${paths.map((d) => `"${d}"`).join(', ')}],`)
  .join('\n')

writeFileSync(
  join(root, 'src/strokes.js'),
  `${header}\n\n// Every path is in this coordinate box, origin top-left.\nexport const STROKE_VIEWBOX = ${VIEWBOX}\n\nexport const strokes = {\n${body}\n}\n`
)

const bytes = readFileSync(join(root, 'src/strokes.js')).length
console.log(`\nsrc/strokes.js  ${Object.keys(out).length} characters, ${strokeCount} strokes, ${(bytes / 1024).toFixed(1)} KB`)
if (missing.length) console.warn(`Missing from KanjiVG: ${missing.join(' ')} — Trace mode skips these.`)
console.log('Rebuild (`npm run build`) so the service worker precaches it.')
