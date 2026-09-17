# Filling in the word list

These six files hold every word the school's kanji list teaches — 762 of them.
The **Written form** column comes from the master list. The **Reading** and
**Meaning** columns are blank and have to be written by hand. That is the job.

47 rows are already filled in, seeded from `content/content.md` (the September
worksheet the app ships with today). **Read a few of those before starting** —
they set the voice.

## The rules

**1. Never edit the Written form column.** It is copied exactly from the school's
list, and it is the key rows are matched on when the file is regenerated. If a
written form looks wrong to you, it is not yours to fix — flag it and move on.
See *Known defects* below.

**2. The written forms are deliberately part-kana, and that is not a mistake.**
The worksheets write part of a word in kana when that kanji has not been taught
yet:

| The list says | It does NOT mean you should write |
| ------------- | --------------------------------- |
| でん車 | 電車 |
| 全ぶ | 全部 |
| 言ば | 言葉 |
| きょう力 | 協力 |
| りょう方 | 両方 |
| きゅう食 | 給食 |
| 分すう | 分数 |
| ず工 | 図工 |

"Correcting" these teaches a ten-year-old something his teacher is not asking
for, and he would be marked wrong for writing it. This mistake has already
shipped once in this project. The rule is in `README.md` § *Adding cards from a
new worksheet* and it is not negotiable.

The **reading**, though, is the reading of the whole word: `でん車` is `でんしゃ`,
not `でんくるま`. This is the part that takes care.

**3. Readings are kana. Never romaji.** ひらがな for Japanese readings, カタカナ
only where the word itself is katakana. No `jitensha`, anywhere, ever — the app
has no romaji in it by design.

**4. Meanings are plain English a ten-year-old would use.** "bicycle", not "a
two-wheeled pedal-driven vehicle". Short. Look at the 47 seeded rows.

**5. A blank row is fine. A wrong row is not.** A row with no reading simply is
not a card yet — the build skips it and nothing breaks. If you are not sure,
**leave it blank** rather than guessing. A plausible-looking wrong reading is
undetectable later and ends up in front of a child.

**6. Leave the table shape alone.** Four columns, in order. Don't add, remove or
reorder them, and don't worry about lining the pipes up — `npm run scaffold`
re-pads everything.

## Flagging — the `Check?` column

The flag exists to point a human at the rows most likely to be **wrong**. It only
works if it discriminates — a flag on every row is the same as no flags at all.

**Do not flag a row merely because you worked the reading out.** The master list
gives readings per *kanji*, never per *word*, so every row is inferred. That is
the normal case, not a risk. Grade 4 was flagged this way and 131 of its 148
flags carried no information.

Flag a row when one of these is true — and say **which**, in a few words:

- **Kana substitution.** The word mixes kana into the middle of a kanji word
  (きゅう食, ず工, こん立て, ひなんくん練) rather than just trailing okurigana. The
  substitution hides which reading the kanji takes, so the whole-word reading is
  a genuine reconstruction.
- **Rendaku you had to decide.** You voiced — or chose not to voice — a sound
  that could go either way: もち米 → もちごめ, せ骨 → せぼね, ひし形 → ひしがた. If
  the choice was yours rather than obvious, flag it.
- **More than one reading fits.** 角 is つの or かど; 風車 is かざぐるま or ふうしゃ.
  If you cannot tell from context, **leave the row blank** and flag it — do not
  pick one.
- **The English is a judgement call**, or the word is school- or place-specific:
  オレゴン州, ポートランド市, フッド山, 姉妹州, ウィラメット川, かま田先生.
- **The source looks wrong.** A missing rendaku or an apparent typo in the
  written form (音とく for 音どく, 北海とう for 北海どう). Flag it, fill in what the
  word actually reads as if you are confident, and never change column 2.

If none of those apply, leave `Check?` empty even though you inferred the
reading. A straightforward compound like 校長先生 or 三角形 needs no flag.

A flagged row is still a usable card. The flag routes attention; it does not
block anything. **A blank row is stronger than a flag** — use it when you are
genuinely unsure, as above.

As a rough calibration: grade 4 has 184 words, and about 50 of them warrant a
flag. If you are flagging most of a grade, the rule is not being applied.

## Known defects in the master list

Left as printed, deliberately. Do not fix them here.

The sheet drops the dakuten (゛) from a handful of words. These are **individual
slips, not a convention** — verified against the scan at 300 dpi, where じどう車
keeps its dakuten in the cell immediately below てん車 which has lost its. Five
found so far:

| Printed | Almost certainly | |
| ------- | ---------------- | --- |
| てん車 | でん車 | 電車, でんしゃ — the September worksheet writes it correctly |
| 音とく | 音どく | 音読, おんどく |
| 北海とう | 北海どう | 北海道, ほっかいどう |
| 角と | 角ど | 角度, かくど |
| 安とう先生 | 安どう先生 | 安藤先生, あんどうせんせい |

For these: **leave column 2 exactly as printed**, fill in the reading the word
actually has (でんしゃ, おんどく, …), and flag the row as a source defect. The
written form is what his teacher put on the page; the reading is what the word
is.

If you find another like this, flag it and name it in your summary rather than
correcting it silently. Missing dakuten is the pattern to watch for.

## Order of work

**Grade 4 is done** — 177 of 184 rows, 7 left blank on purpose. It is the best
set of worked examples in the project now; read some of it before you start.

Remaining, in order of usefulness: **grade 5**, grade 3, grade 2, challenge,
grade 1.

**One grade per session is a reasonable chunk.** There is no need to finish
everything at once — `npm run scaffold` reports what is left.

Grade 5 is the biggest at 232 words. Splitting it across two sessions by Group
(Groups 1–2, then 3–4) is fine; the file is safe to leave half-filled.

## Where things are

| Path | |
| ---- | --- |
| `content/words/*.md` | the rows to fill in — this is what you edit |
| `content/kanji-list/current` | names the active edition of the master list |
| `content/kanji-list/2022-08/list.json` | the master list: every word, its grade, the kanji hosting it, and that kanji's readings |
| `content/content.md` | the September worksheet — 47 worked examples |
| `README.md` § Adding cards | the kana-substitution rule in the project's own words |

`list.json` is worth opening. Each word sits under the kanji that hosts it,
alongside that kanji's readings — which is usually enough to work out the word's
reading, and which is where the `(N)` grade tags come from.

## Checking your work

```
npm run scaffold
```

Re-running is safe at any time: it merges on the written form and **never
overwrites a cell you have filled in**. It prints how many rows are filled, how
many are blank, and how many are flagged.

Do not run `npm run cards`, `fonts`, `strokes` or `check` — those are wired to
the old single-file deck until a later stage of this project, and are not part
of this job.

## What not to touch

Nothing outside `content/words/`. Not `src/`, not `scripts/`, not
`content/content.md`, not the master list. If something outside this directory
looks wrong, say so in your summary instead of changing it.

When you finish a grade, report: how many rows you filled, how many you flagged
and why, how many you left blank and why, and anything about the source data
that looked wrong.
