/* Reports how guessable the multiple-choice questions are.
   Run with `npm run audit` after adding or editing cards.

   A question "leaks" when the correct option is the only one whose okurigana
   can fit the prompt — a child can then answer without reading any kanji.
   The app already picks distractors to avoid this; what this reports is the
   residue, which is a property of the deck rather than of the code: a card
   can only be disguised if other cards in the deck share its shape. */

import { cards as rawCards } from '../src/cards.js'
import { buildChoices, facesOf, answerFaceOf, isPlausible, tailOf } from '../src/choices.js'

const CHOICE_COUNT = 3
const TRIALS = 200
const cards = rawCards.map((card, id) => ({ ...card, id }))
const DIRECTIONS = ['reading-first', 'written-first']

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—')

let worstCards = []

for (const direction of DIRECTIONS) {
  let leaks = 0
  let asked = 0
  const perCard = new Map()

  for (let t = 0; t < TRIALS; t++) {
    for (const card of cards) {
      const prompt = facesOf(card, direction).prompt
      // In written-first a kanji-only prompt reveals nothing about its reading,
      // so those questions cannot leak this way and are not counted.
      if (direction === 'written-first' && tailOf(prompt) === '') continue

      const options = buildChoices(cards, card, direction, CHOICE_COUNT)
      const plausible = options.filter((o) =>
        isPlausible(answerFaceOf(o, direction), prompt, direction)
      )
      asked++
      if (plausible.length === 1) {
        leaks++
        perCard.set(card.id, (perCard.get(card.id) ?? 0) + 1)
      }
    }
  }

  console.log(`\n${direction}: ${pct(leaks, asked)} of questions answerable without reading (${leaks}/${asked})`)

  const always = [...perCard.entries()]
    .filter(([, n]) => n >= TRIALS * 0.9)
    .map(([id]) => cards.find((c) => c.id === id))
  if (always.length) {
    console.log(`  ${always.length} card(s) the deck cannot disguise — no other card shares their ending:`)
    for (const c of always) {
      const prompt = facesOf(c, direction).prompt
      console.log(`    ${prompt} → ${answerFaceOf(c, direction)}   (ending 「${tailOf(prompt) || '—'}」)`)
    }
    worstCards.push(...always.map((c) => `${c.reading} / ${c.written}`))
  }
}

console.log(
  `\nAdd a card sharing the ending of any listed above and it stops being guessable.` +
    `\nNothing here is a code failure — the picker is already doing the best the deck allows.\n`
)
