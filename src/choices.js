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

/* Kana that are genuinely mistaken for one another.

   Every other signal in this file is derived from the card data — okurigana,
   shared kanji, length. None of them survive a single character: `KANJI` never
   matches, so the shared-kanji term cannot fire, and `tailOf` returns the whole
   character, which makes `isPlausible` reduce to exact equality and score every
   candidate zero. Measured: any two hiragana score 3 against each other, with
   nothing separating one pair from another. Distractors would be random and the
   questions free.

   What makes two kana confusable is how they LOOK, and that is not in the data.
   So this is the one hand-maintained table in the project. Add to it when a
   real child confuses a real pair; that is the only evidence worth having.

   Groups are mutually confusable, and a character may appear in several. */
const CONFUSABLE = [
  // hiragana
  ['あ', 'お'], ['い', 'り'], ['う', 'つ'], ['き', 'さ', 'ち'], ['く', 'へ'],
  ['け', 'は', 'ほ'], ['こ', 'に'], ['す', 'む'], ['せ', 'ひ'], ['そ', 'ろ', 'る'],
  ['た', 'な'], ['ぬ', 'め'], ['ね', 'れ', 'わ'], ['ま', 'も'], ['は', 'ほ'],
  // katakana
  ['ア', 'マ'], ['ウ', 'ワ', 'ク'], ['オ', 'ホ'], ['カ', 'ヤ'], ['キ', 'サ'],
  ['ク', 'ケ', 'タ'], ['コ', 'ユ'], ['シ', 'ツ'], ['ソ', 'ン'], ['ス', 'ヌ', 'メ'],
  ['セ', 'ヒ'], ['チ', 'テ'], ['ナ', 'メ'], ['ハ', 'ヘ'], ['フ', 'ワ', 'ヲ'],
  ['マ', 'ム'], ['ミ', 'シ'], ['ヨ', 'ヲ'], ['ラ', 'ヲ'], ['ル', 'レ'],
  ['ノ', 'ソ', 'ン'],
]

const CONFUSION = new Map()
for (const group of CONFUSABLE) {
  for (const ch of group) {
    if (!CONFUSION.has(ch)) CONFUSION.set(ch, new Set())
    for (const other of group) if (other !== ch) CONFUSION.get(ch).add(other)
  }
}

/* Weighted like `isPlausible`, and for the same reason: being a candidate the
   child cannot rule out on sight matters more than any resemblance score. The
   two never compete — a single kana is never plausible under the okurigana
   rule, because that rule reduces to exact equality at length one. */
export const confusable = (a, b) => Boolean(CONFUSION.get(a)?.has(b))
export const confusionBonus = (a, b) => (confusable(a, b) ? 10 : 0)

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
  /* `id` is the written form, so this also excludes a twin — the same word
     present twice because it appears in two sets. An array index would not
     have: the twins have different indices and are the same card. */
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
    candidates.push({
      card: other,
      /* The confusion bonus is keyed on the WRITTEN forms rather than on
         whichever face this direction happens to show, because that is where
         the resemblance lives — シ and ツ look alike; "shi" and "tsu" do not. */
      score:
        scoreCandidate(face, correct, promptFace, direction) +
        confusionBonus(card.written, other.written),
    })
  }

  // Shuffled first, so equal scores stay varied between rounds.
  candidates.sort((a, b) => b.score - a.score)

  return shuffle([card, ...candidates.slice(0, count - 1).map((c) => c.card)])
}
