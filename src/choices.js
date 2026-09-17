/* Card sides and distractor choice ----------------------------------------
   Shared by the app and by `npm run audit`, so the audit can never drift from
   what the app actually does.
   ------------------------------------------------------------------------- */

export function shuffle(list) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// The card's two sides, per practice direction.
export function facesOf(card, direction) {
  return direction === 'reading-first'
    ? { prompt: card.reading, answer: card.written, echo: card.reading }
    : { prompt: card.written, answer: card.reading, echo: card.written }
}

export const answerFaceOf = (card, direction) => facesOf(card, direction).answer

const KANJI = /[一-鿿]/

function charClass(ch) {
  if (KANJI.test(ch)) return 'K'
  if (/[゠-ヿ]/.test(ch)) return 'k' // katakana
  if (/[぀-ゟ]/.test(ch)) return 'h' // hiragana
  return 'x'
}

// The okurigana trailing the last kanji — the part that leaks the answer.
// For an all-kana face (a reading) the final character plays the same role.
export function tailOf(face) {
  const chars = [...face]
  let lastKanji = -1
  chars.forEach((ch, i) => {
    if (KANJI.test(ch)) lastKanji = i
  })
  return lastKanji === -1 ? chars.slice(-1).join('') : chars.slice(lastKanji + 1).join('')
}

function shapeOf(face) {
  return {
    pattern: [...face].map(charClass).join(''),
    tail: tailOf(face),
    length: [...face].length,
    kanji: new Set([...face].filter((ch) => KANJI.test(ch))),
  }
}

// A distractor is eliminable when its okurigana cannot fit the prompt: shown
// いく, a child can rule out 言ば and 出す without reading them at all, which
// leaves the answer standing alone. These are the candidates to avoid.
export function isPlausible(candidateFace, promptFace, direction) {
  if (direction === 'reading-first') {
    // Candidate is a written form; its okurigana must end the reading shown.
    const tail = tailOf(candidateFace)
    return tail === '' || promptFace.endsWith(tail)
  }
  // Candidate is a reading; it must end with the prompt's okurigana.
  const tail = tailOf(promptFace)
  return tail === '' || candidateFace.endsWith(tail)
}

// Higher means harder to tell apart without actually reading it.
function similarity(a, b) {
  let score = 0
  if (a.tail === b.tail) {
    score += 3 // same okurigana
  } else if (a.tail && b.tail && a.tail.slice(-1) === b.tail.slice(-1)) {
    score += 2 // partial credit: 分ける against 食べる still ends in る
  }
  if (a.pattern === b.pattern) score += 2 // same kanji/kana arrangement
  if ([...a.kanji].some((ch) => b.kanji.has(ch))) score += 2 // shares a kanji
  if (a.length === b.length) score += 1
  return score
}

export function scoreCandidate(candidateFace, correctFace, promptFace, direction) {
  // Not being eliminable matters more than looking similar, so it outweighs
  // every shape signal combined.
  return (
    (isPlausible(candidateFace, promptFace, direction) ? 10 : 0) +
    similarity(shapeOf(correctFace), shapeOf(candidateFace))
  )
}

/* Picking distractors at random makes many cards answerable without reading
   any kanji: asked おおい, a child shown 多い / 社会 / 中国 can just match the
   trailing い. Candidates are instead scored on whether they can be ruled out
   on shape alone, then on how closely they resemble the answer — so 多い is
   offered against 太い and 細い, where the okurigana gives nothing away.

   All of this is derived from the card data, so new cards are handled
   automatically with no list to maintain. */
export function buildChoices(cards, card, direction, count) {
  const correct = answerFaceOf(card, direction)
  const promptFace = facesOf(card, direction).prompt
  const seen = new Set([correct])

  const candidates = []
  for (const other of shuffle(cards.filter((c) => c.id !== card.id))) {
    const face = answerFaceOf(other, direction)
    if (seen.has(face)) continue // never show the same text twice
    /* And never show a card that answers the same question. Refusing a
       duplicate ANSWER face is not enough: asked こう with 校 correct, 高 is a
       different answer face and an equally correct one. What makes two cards
       interchangeable is a shared PROMPT face, so that is what is excluded.

       A build-time rule over content/ cannot cover this. 54 readings collide
       across the curriculum — the syllabus re-teaching a word as more of its
       kanji arrive — and the pool widens across decks when a selection is
       small, so a collision the generator allowed can still meet its twin in
       one question. Custom worksheets and a new edition of the list can each
       introduce more. This is the guarantee that holds at runtime. */
    if (facesOf(other, direction).prompt === promptFace) continue
    seen.add(face)
    candidates.push({ card: other, score: scoreCandidate(face, correct, promptFace, direction) })
  }

  // Shuffled first, so equal scores stay varied between rounds.
  candidates.sort((a, b) => b.score - a.score)

  return shuffle([card, ...candidates.slice(0, count - 1).map((c) => c.card)])
}
