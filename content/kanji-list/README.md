# Transcribing a new edition of the master list

Each edition of the school's kanji list lives in its own dated directory beside
the others, never overwriting them. `current` is a one-line pointer naming the
active one — a text file, not a symlink, because this repo syncs through Google
Drive and symlinks do not survive that.

```
content/kanji-list/
  2022-08/  kanji-grades-1-5.pdf   list.json
  current                          ← "2022-08"
```

## The procedure

The scan has **no text layer** — `pdftotext` returns 9 bytes on the 2022 PDF.
Every row is read from page renders, so the method matters.

1. `pdftoppm -r 300 -png <pdf> pg`. 150 dpi is not enough: it cannot reliably
   separate 読 from 語, and it loses dakuten.
2. Crop each page into column halves before reading — `no`/kanji/readings on the
   left, usage on the right. A full-page render gets downscaled back to roughly
   150 dpi on the way in, throwing away the resolution you just paid for.
3. **Transcribe twice, independently, and diff the two passes.** On the 2022
   edition this found no disagreement, which is what licenses trusting it.
4. Structural checks: numbers gapless, no duplicate kanji, every kanji appears in
   at least one of its own usage words, no latin characters in a Japanese field.

## What went wrong in 2022, and how to not repeat it

The double pass covered **row identity only** — number, kanji, grade. The 838
usage words were transcribed once. One error survived: `北海とう` was written down
as `北海どう` under 海, silently "corrected" while reading, even though the same
word appears correctly as `北海とう` under 北 two pages later.

It was caught much later, by accident, when duplicate readings were counted
across the finished word list and the same word appeared twice in one grade.

**So: double-pass the usage words too, or run this check.** Words that are
identical once dakuten and handakuten are stripped are almost always one word
transcribed two ways:

```python
V = dict(zip('がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽ',
             'かきくけこさしすせそたちつてとはひふへほはひふへほ'))
devoice = lambda w: ''.join(V.get(c, c) for c in w)
# group every usage word by devoice(word); any group with >1 member is suspect
```

The general lesson: **the transcriber's instinct is to fix what looks wrong**,
and that instinct is the enemy here. The sheet's oddities are data.

## The sheet's own defects are not transcription errors

Five words are printed without their dakuten. Verified at 300 dpi — じどう車
keeps its dakuten in the cell directly below てん車, which has lost its, so these
are individual slips rather than a convention.

| Printed | Is |
| ------- | -- |
| てん車 | 電車 でんしゃ |
| 音とく | 音読 おんどく |
| 北海とう | 北海道 ほっかいどう |
| 角と | 角度 かくど |
| 安とう先生 | 安藤先生 あんどうせんせい |

These stay exactly as printed. The written form is what the teacher put on the
page and what the child is marked against; the reading is what the word says.
See `content/words/README.md`.

## Shading

The orange fill on a kanji cell means *must write*; unshaded means *read only*.
It is real data and the least reliable thing to read off a render. Verify it per
row before any feature depends on it.
