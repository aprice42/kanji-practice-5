/* Reports how guessable the multiple-choice questions are.
   Run with `npm run audit` after adding or editing cards.

   A question "leaks" when the correct option is the only one whose okurigana
   can fit the prompt — a child can then answer without reading any kanji.
   The app already picks distractors to avoid this; what this reports is the
   residue, which is a property of the deck rather than of the code: a card
   can only be disguised if other cards in the deck share its shape. */

import { cards as rawCards, SETS } from '../src/cards.js'
import { buildChoices, facesOf, answerFaceOf, isPlausible, tailOf } from '../src/choices.js'

const CHOICE_COUNT = 3
/* Trials per card. The pool is 794 cards, so running 200 trials against every
   one of them takes minutes for a number nobody reads; a set is audited against
   its own cards, which is the pool a round actually draws from. */
const TRIALS = 200
// Identity is the written form — the same key the app uses. See src/main.js.
const allCards = rawCards.map((card) => ({ ...card, id: card.written }))
const DIRECTIONS = ['reading-first', 'written-first']

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—')

/* A set names itself on the command line; with no argument every set is audited
   in the manifest's order. `npm run audit -- g4` while working on one.

   Sets, not decks: a deck was a quarter of a grade cut at an arbitrary point,
   so auditing one measured a pool no one deliberately chose. */
const wanted = process.argv.slice(2)
const sets = (SETS ?? [{ id: null, label: 'Everything' }]).filter(
  (s) => !wanted.length || wanted.includes(s.id)
)
if (!sets.length) {
  console.error(`No such set. Known: ${SETS.map((s) => s.id).join(', ')}`)
  process.exit(1)
}

for (const set of sets) auditSet(set)

function auditSet(set) {
/* Distractors come from the set being played, because that is what the app
   does — a question can only be disguised by cards that could appear beside
   it. Auditing against all 794 would report a number the child never sees. */
const cards = set.id ? allCards.filter((c) => c.sets.includes(set.id)) : allCards

console.log(`\n${'='.repeat(58)}\n${set.id ?? 'all'}  ${set.label} — ${cards.length} cards`)
if (cards.length < CHOICE_COUNT + 1) {
  console.log('  Too few cards to build a question from this deck alone.')
  return
}

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

if (worstCards.length) {
  console.log(
    `\n  Add a card sharing the ending of any listed above and it stops being guessable.` +
      `\n  Nothing here is a code failure — the picker is already doing the best the deck allows.`
  )
}
}

console.log('')
