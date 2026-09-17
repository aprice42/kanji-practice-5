/* Parsing a deck's Markdown into card rows.

   Shared by `npm run cards`, which writes src/cards.js, and `npm run check`,
   which re-parses the Markdown to confirm src/cards.js is not stale. They have
   to agree about what the tables say, so they read them with the same code —
   the same reason scripts/audit-choices.mjs imports src/choices.js rather than
   reimplementing the distractor scoring.

   Two source shapes feed this, and one parser reads both:

     content/worksheets/*.md   a worksheet as the teacher sent it home
     content/words/*.md        a grade of the school's master list, cut into
                               `## Group N` sections by `npm run scaffold`

   The grade files carry a fourth column, `Check?`, holding a reviewer's note.
   It is parsed, counted and reported — and never emitted into src/cards.js, so
   it never reaches the font subset either. */

/* One row per card: | reading (kana) | written form | meaning | check? |.
   Header and separator rows are skipped, as is anything that is not a three-
   or four-cell row.

   Returns the document's title, its rows grouped by the `##` heading they fall
   under, and how many 〔…〕 reference notes were stripped. A document with no
   `##` heading is one unnamed group, which is what a worksheet is. */
export function parseCards(md) {
  let title = ''
  const groups = []
  let current = null

  const open = (name) => {
    current = { name, rows: [], notes: [] }
    groups.push(current)
    return current
  }

  for (const line of md.split('\n')) {
    const trimmed = line.trim()

    const h1 = /^#\s+(.*)$/.exec(trimmed)
    if (h1) {
      title ||= h1[1].trim()
      continue
    }
    const h2 = /^##\s+(.*)$/.exec(trimmed)
    if (h2) {
      open(h2[1].trim())
      continue
    }

    if (!trimmed.startsWith('|')) continue
    const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
    /* Three OR four: the scaffold's `Check?` column is a fourth cell, and the
       old `cells.length !== 3` would have dropped every one of those rows
       without saying so. */
    if (cells.length < 3 || cells.length > 4) continue
    if (cells[0].startsWith('Reading')) continue // header
    if (/^[-\s]+$/.test(cells[0])) continue // separator

    const [reading, written, meaning, note = ''] = cells
    if (!current) open('')
    current.rows.push([reading, written, meaning])
    if (note) current.notes.push({ written, note })
  }

  /* The September worksheet keeps the full kanji form as a note in 〔…〕 —
     全ぶ〔全部〕 — which is useful reference but is NOT what the worksheet asks
     him to write. Strip it so the cards show exactly the worksheet's form. */
  let stripped = 0
  for (const group of groups) {
    for (const row of group.rows) {
      const bare = row[1].replace(/〔.*?〕/g, '').trim()
      if (bare !== row[1]) stripped++
      row[1] = bare
    }
  }

  return { title, groups, stripped }
}

/* A row with no reading or no meaning is not a card yet. The grade files are
   scaffolded blank and filled in by hand, and 18 rows are deliberately blank
   because the sheet gives two readings and no way to choose — so the build has
   to skip them rather than emit a card with an empty face. */
export const isFilled = ([reading, , meaning]) => Boolean(reading && meaning)

/* Two cards sharing a reading make a multiple-choice question with two correct
   answers — but only if both can appear in the same round, which means only
   within one group. Across the whole curriculum collisions are the syllabus
   working as designed: a word is re-taught as more of its kanji become
   available, so じどうしゃ is legitimately じどう車, 自どう車 and 自動車.

   54 readings collide across the 743 cards. Exactly one collision is inside a
   single group, and it is real source data (below). So: fatal within a group,
   reported across decks. src/choices.js carries the runtime guarantee, by
   refusing a distractor whose prompt face matches the question's. */
export function duplicateReadings(rows) {
  const byReading = new Map()
  for (const [reading, written] of rows) {
    if (!reading) continue
    if (!byReading.has(reading)) byReading.set(reading, [])
    byReading.get(reading).push(written)
  }
  return [...byReading]
    .filter(([, forms]) => forms.length > 1)
    .map(([reading, forms]) => ({ reading, forms }))
}

/* The one within-group collision in the 2022 edition. 画用紙 is printed twice,
   spelled two ways — が用紙 under 紙 and が用し under 用 — both verified against
   the scan at 300 dpi. It is not a transcription error and must not be "fixed"
   in the content, so it is named here instead, where a NEW collision still
   fails the build. */
const ALLOWED_COLLISIONS = new Set(['がようし'])

export const isAllowedCollision = ({ reading }) => ALLOWED_COLLISIONS.has(reading)

/* Every Japanese character the deck needs a glyph for — readings and meanings
   included, since the meaning line is rendered too. */
export function deckCharacters(cards) {
  const chars = new Set()
  for (const card of cards) for (const ch of card.reading + card.written + card.meaning) chars.add(ch)
  return chars
}

export const isJapanese = (ch) => ch.codePointAt(0) > 0x2e80

/* KanjiVG draws kanji and kana; it has no entry for these, and the master list
   really does use all three — 春（夏、冬）休み, 〜の間, 〜の次. Trace mode passes
   over them, which is correct: there is no stroke order to teach for a bracket.

   `npm run strokes` discovers a new one by getting a 404 and saying so. Add it
   here when it does, or `npm run check` will demand stroke data that cannot
   exist and the build stays red forever. */
const NOT_IN_KANJIVG = new Set(['（', '）', '〜'])

export const isTraceable = (ch) => !NOT_IN_KANJIVG.has(ch)
