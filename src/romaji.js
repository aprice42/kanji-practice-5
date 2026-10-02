/* Romaji, for searching only --------------------------------------------------

   The app has no romaji in it by design — `content/words/README.md` is explicit
   that readings are kana and never `jitensha`. Nothing here contradicts that:
   this is a key computed at runtime so that a child on a Chromebook with no
   kana keyboard can type `kurai` and find 暗い. It never reaches content, never
   reaches `cards.js`, and is never rendered.

   Both a card's reading and whatever someone types are reduced into one space
   so they can be compared. The space is Kunrei-ish — si, sya, tu, hu, zi, ti,
   tya — because that is the spelling that falls out of the gojūon grid, which
   makes the card side a table walk rather than a pile of exceptions. The query
   side then has to be rewritten into it, which is what `reduceQuery` does.

   The reduction is deliberately forgiving: `densha`, `densya` and `denshya` all
   land on the same key, and so do `suiyoubi`, `suiyobi` and `suiyōbi`. That
   costs nothing. Measured over the 745 non-kana readings, this produces 689
   distinct keys and 54 collision groups — and recomputing the collisions
   BEFORE the forgiving rules run gives the same 54. Every one of them is a
   kana-level homophone that the existing reading search already merges: 53 are
   the corpus's own duplication (水よう日 and 水曜日 are the same word spelt two
   ways), and one is にほん, which is genuinely 日本, 日ほん and 二本.
   --------------------------------------------------------------------------- */

/* The gojūon, by row. The vowels are positional, so each row is five syllables
   and the consonant is the row's own letter — `sa si su se so`, not `sa shi su
   se so`. The voiced and half-voiced rows sit in the same grid, which is why
   they need no separate handling: ざ is just the z row. */
const ROWS = [
  ['', 'あいうえお'],
  ['k', 'かきくけこ'],
  ['s', 'さしすせそ'],
  ['t', 'たちつてと'],
  ['n', 'なにぬねの'],
  ['h', 'はひふへほ'],
  ['m', 'まみむめも'],
  ['r', 'らりるれろ'],
  ['g', 'がぎぐげご'],
  ['z', 'ざじずぜぞ'],
  ['b', 'ばびぶべぼ'],
  ['p', 'ぱぴぷぺぽ'],
]

const VOWELS = 'aiueo'

const BASE = {}
for (const [consonant, kana] of ROWS) {
  for (let i = 0; i < 5; i++) BASE[kana[i]] = consonant + VOWELS[i]
}

/* The d row is the one that does not fit the grid. ぢ and づ go onto the z row
   rather than getting di/du of their own: they are homophones of じ and ず in
   modern Japanese, so for a search box merging them is the right answer rather
   than a shortcut. */
Object.assign(BASE, { だ: 'da', ぢ: 'zi', づ: 'zu', で: 'de', ど: 'do' })

Object.assign(BASE, {
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  わ: 'wa',
  /* を is `wo`, following the kana cards. `content/kana/hiragana.md` records
     this as the one deliberate departure from Hepburn in this project, on the
     grounds that a child is taught the character as "wo". */
  を: 'wo',
  ん: 'n',
  /* Standalone small vowels. As combiners they are handled separately below. */
  ぁ: 'a',
  ぃ: 'i',
  ぅ: 'u',
  ぇ: 'e',
  ぉ: 'o',
  ゃ: 'ya',
  ゅ: 'yu',
  ょ: 'yo',
})

const YOON = new Set(['ゃ', 'ゅ', 'ょ'])
const SMALL_VOWEL = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }

/* Katakana first, so the table only ever has to know hiragana. This also
   disposes of ッ and the katakana half of every loanword for free. ー is left
   alone deliberately — it is outside this range and is dropped in the walk. */
const toHiragana = (text) =>
  text.replace(/[ァ-ン]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))

/* The consonant of a syllable is whatever is in front of its vowel, so し (si)
   gives s and き (ki) gives k. That is the whole of the digraph rule: しゃ is
   s + ya, ちゃ is t + ya. */
const consonantOf = (romaji) => romaji.slice(0, -1)

function walk(kana) {
  const text = toHiragana(kana)
  let out = ''
  let sokuon = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const next = text[i + 1]

    /* っ carries no sound of its own; it doubles the consonant that follows.
       Kept rather than flattened: it is phonemic, it is on the hiragana card
       list as something the app teaches, and flattening it would quietly merge
       きて with きって the first time such a pair arrives. */
    if (ch === 'っ') {
      sokuon = true
      continue
    }
    /* The long mark lengthens the vowel before it. Dropping it is equivalent,
       because `reduce` collapses a doubled vowel anyway. */
    if (ch === 'ー') continue

    let romaji = BASE[ch]
    if (romaji === undefined) {
      // Anything the table does not know passes through untouched.
      out += ch
      continue
    }

    if (next && YOON.has(next)) {
      romaji = consonantOf(romaji) + BASE[next]
      i++
    } else if (next && SMALL_VOWEL[next]) {
      /* Foreign sounds: ティ, ファ, ジェ. う is the exception — ウィ is wi, not
         i, because the small vowel replaces う's vowel but keeps its glide. */
      romaji = (ch === 'う' ? 'w' : consonantOf(romaji)) + SMALL_VOWEL[next]
      i++
    }

    if (sokuon) {
      romaji = romaji[0] + romaji
      sokuon = false
    }
    out += romaji
  }

  return out
}

/* The forgiving half, run on BOTH sides so they meet in the middle. Long vowels
   go because a learner has no reason to know whether a word is spelt ou or oo,
   and the nasal rules go because n before a labial is written m in Hepburn and
   n in Kunrei. */
function reduce(romaji) {
  return romaji
    .replace(/[āâ]/g, 'a')
    .replace(/[īî]/g, 'i')
    .replace(/[ūû]/g, 'u')
    .replace(/[ēê]/g, 'e')
    .replace(/[ōô]/g, 'o')
    .replace(/ou|oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/ee/g, 'e')
    .replace(/ii/g, 'i')
    .replace(/nn/g, 'n')
    .replace(/m([bpm])/g, 'n$1')
}

/* A reading's keys. Plural because one row holds three words:
   はるやすみ（なつやすみ、ふゆやすみ）. Splitting on the full-width brackets and
   comma is what lets `fuyuyasumi` find it; without it only the first word is
   reachable. Those three characters are the only non-kana in all 745 readings. */
export function romajiKeys(reading) {
  return reading
    .split(/[（）、,()]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => reduce(walk(part)))
}

/* What someone typed, rewritten into the same space.

   The order is load-bearing twice. `tch` has to go before `ch`, or `matcha`
   becomes matya while まっちゃ becomes mattya and the two never meet. And `sh`
   has to go before `syi`, which is what keeps し (si) apart from しゃ (sya)
   while still merging the typed `shi` into `si`.

   This must NEVER be applied to a query that will also be matched against an
   English meaning. It turns `fish` into hisy, `jump` into zyunp and `cats` into
   cat; the meaning tier in builderMatches keeps the raw query for that reason. */
export function reduceQuery(query) {
  return reduce(
    query
      .toLowerCase()
      .replace(/[ー'’\-_\s]/g, '')
      .replace(/tch|cch/g, 'tty')
      .replace(/shy/g, 'sy')
      .replace(/chy/g, 'ty')
      .replace(/jy/g, 'zy')
      .replace(/sh/g, 'sy')
      .replace(/ch/g, 'ty')
      .replace(/j/g, 'zy')
      .replace(/ts/g, 't')
      .replace(/f/g, 'h')
      .replace(/syi/g, 'si')
      .replace(/tyi/g, 'ti')
      .replace(/zyi/g, 'zi')
  )
}

/* Plain ASCII letters only. A query with a kanji or a kana in it is not romaji
   and must not go down this path — it would reduce to nonsense and match at
   random. */
export const isRomaji = (query) => /^[a-zāīūēōâîûêô'’\-_\s]+$/i.test(query)
