/* Parsing content/content.md into card rows.

   Shared by `npm run cards`, which writes src/cards.js, and `npm run check`,
   which re-parses content.md to confirm src/cards.js is not stale. They have to
   agree about what the table says, so they read it with the same code — the
   same reason scripts/audit-choices.mjs imports src/choices.js rather than
   reimplementing the distractor scoring. */

/* One row per card: | reading (kana) | written form | meaning |. Header and
   separator rows are skipped, as is anything that is not a three-cell row. */
export function parseCards(md) {
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

  /* content.md keeps the full kanji form as a note in 〔…〕 — 全ぶ〔全部〕 — which
     is useful reference but is NOT what the worksheet asks him to write. Strip
     it so the cards show exactly the worksheet's form. */
  let stripped = 0
  for (const row of rows) {
    const bare = row[1].replace(/〔.*?〕/g, '').trim()
    if (bare !== row[1]) stripped++
    row[1] = bare
  }

  return { rows, stripped }
}

/* Two cards sharing a reading would make a multiple-choice question have two
   correct answers. */
export function duplicateReading(rows) {
  const seen = new Set()
  for (const [reading] of rows) {
    if (seen.has(reading)) return reading
    seen.add(reading)
  }
  return null
}

/* Every Japanese character the deck needs a glyph for — readings and meanings
   included, since the meaning line is rendered too. */
export function deckCharacters(cards) {
  const chars = new Set()
  for (const card of cards) for (const ch of card.reading + card.written + card.meaning) chars.add(ch)
  return chars
}

export const isJapanese = (ch) => ch.codePointAt(0) > 0x2e80
