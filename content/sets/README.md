# Practice sets

A practice set is a hand-picked list of words to study together — a test's word list, a set of kanji he keeps missing, whatever is useful. One file per set, and they appear in the app's picker under **Practice sets**.

A set file **defines nothing**. It lists written forms that `content/words/` and `content/worksheets/` already define, and the build fails if one of them does not resolve. That is the whole safety net: a mistyped word is caught at build time rather than quietly practising 29 words when you meant 30.

```md
# Week 3 test

- 人口
- 正方形
- ほうれん草
```

The `#` heading is the set's name, shown in the picker. Everything else is ignored, so notes and prose between the items are fine.

## The rules

**Copy the written form exactly, kana substitutions and all.** `きょう力`, not `協力`; `でん車`, not `電車`. The forms in `content/words/` are the school's, and they are what the app matches on. If a word will not resolve, the spelling is the first thing to check.

**A word can be in as many sets as you like.** It is still one card — it just belongs to more sets. Nothing is duplicated and its score is not split.

**Do not list the same word twice in one file.** The build says so.

**Name each file something you will recognise.** `week-3-test.md` becomes the set id `s:week-3-test`; the heading inside is what the picker shows.

## After editing

```
npm run cards && npm run check
```

`cards` resolves every listed word and fails by name if one does not exist. `check` re-derives the same thing independently and compares it to what was generated. Neither needs `fonts` or `strokes` unless the words are new to the app, which they cannot be — a practice set can only name words that already exist.

## Where the words are

| | |
| --- | --- |
| `content/words/*.md` | the school's master list, one file per grade — most words live here |
| `content/worksheets/*.md` | worksheets as the teacher sent them home |
| `content/sets/` | this directory |

There are no practice sets yet. This directory holds only these notes until the first one is written.
