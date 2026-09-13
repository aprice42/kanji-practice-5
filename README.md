# Kanji Practice

Flashcard PWA for a kanji review list — currently 51 cards, transcribed from worksheets
his teacher sends home. The card data lives in `content/content.md`; see **Adding cards
from a new worksheet** below.

The app opens on a home screen where you pick a mode. Both modes share the same deck,
scoring, progress bar and results screen, and both support the direction switch:

- **かな → 漢字** — see the reading, recall the written form (default)
- **漢字 → かな** — see the written form, recall the reading

### Flash cards

Prompt → tap **Show answer** → the other side plus the meaning → tap ✓ or ✕, which scores
the card and advances. Self-marked.

### Multiple choice

Prompt plus three options — the right answer and two distractors.
Tapping an option marks it right or wrong and reveals the meaning, then a verdict appears
("Correct" or "Not quite — it's 魚") with a **Continue** button. Nothing advances until
that button is tapped, so there is no time pressure on reading the answer.

#### Choosing distractors

Picking the two wrong options at random made many cards answerable without reading any
kanji. Asked おおい, a child shown 多い / 社会 / 中国 only has to match the trailing い —
and 社会 and 中国 can be ruled out on shape alone, leaving the answer standing by itself.

`src/choices.js` scores every other card as a candidate:

- **Can it be eliminated on shape?** A candidate whose okurigana cannot fit the prompt is
  worth avoiding, and this outweighs every other signal combined.
- **Does it resemble the answer?** Same okurigana, same kanji/kana arrangement, shares a
  kanji, same length.

The two best-scoring candidates are used, shuffled so equal scores stay varied. おおい now
draws 多い / 太い / 細い. This is all derived from the card data, so **new cards need no
configuration** — nothing to maintain by hand.

Measured over the 51-card deck as it stands, questions answerable without reading any
kanji (re-check with `npm run audit` after adding cards):

| Direction | Before | After |
| --- | --- | --- |
| かな → 漢字 | 11.3% | **0%** |
| 漢字 → かな | 90.5% | **35%** |

#### `npm run audit`

Run after adding or editing cards. It reports the same figures and lists any card the deck
cannot disguise — one whose ending no other card shares, like 分ける, where わける is the
only reading in the deck ending in ける. That is a property of the deck, not a bug: add a
card sharing the ending and it stops being guessable. The audit imports `src/choices.js`,
the same module the app uses, so the two cannot drift apart.

### Menu

The ☰ menu in the top bar switches to the other mode (restarting the round in it), sets the
theme and colour scheme, starts over, or returns home. Theme and scheme are also on the
home screen; the two controls stay in sync.

### Theme and colour scheme

**Auto / Light / Dark** on the home screen and in the menu — Auto follows the device
setting, Light and Dark override it.

**Colour scheme** on the home screen and in the menu, four options, default Indigo:

| Scheme | Primary | Correct | Wrong |
| --- | --- | --- | --- |
| Indigo (藍と柿) | indigo | moss | persimmon |
| Ink (墨と朱) | sumi charcoal | bamboo | vermilion |
| Matcha (抹茶) | teal | olive | terracotta |
| Plum (梅と柚子) | plum | leaf | clay |

Each is a complete token set for light and dark, validated so text pairs clear 4.5:1,
control edges clear 3:1, and the primary / correct / wrong hues stay at least 48° apart so
no two roles read as the same colour. None use pure white or black grounds.

Both choices persist to `localStorage`. The `theme-color` meta tag is read back from the
live `--bg` token, so browser and PWA chrome match whichever scheme is active.

Palette tokens live at the top of `src/style.css` as `[data-palette]` blocks; `main.js`
stamps `data-palette` and `data-theme` on the root element.

### Typeface

Japanese text is set in **Klee One** (教科書体, textbook style), self-hosted from
`public/fonts/` and subset to just the characters these cards use — about 50 KB per weight
instead of several megabytes, and precached by the service worker so it works offline.

This is not only a style choice. 言 and other characters are drawn differently in Japanese
and Chinese fonts while sharing a Unicode code point, so a device that falls back to a
Chinese CJK font renders the wrong shape — which is what happened before the font was
bundled. Shipping the font removes the guesswork.

`:root :lang(ja)` in `src/style.css` applies the face; every kanji and kana string in
`main.js` carries `lang="ja"`, so no per-component rule is needed. **If you add cards with
new kanji, regenerate the subset** or those characters will fall back to a system font —
see `public/fonts/README.md`.

### Icons

No emoji. Every mark is inline SVG on a 48×48 grid stroked with `currentColor` (`ICONS` in
`src/main.js`), so it takes the active palette: a tick for correct, a cross for wrong, a
sparkle for a clean sweep, and card/list glyphs for the two modes. Correct and wrong are
distinguished by shape as well as colour, and each carries a text label for screen readers.

### Results

A score, a table of the missed cards and a table of the correct ones (reading + written
form), and two buttons: **Practice the N missed** — another round with just those — and
**Start over**. Getting a card right on a retry flips it from missed to correct, so the
score climbs toward a clean sweep. Clear the whole set and you get confetti (skipped for
`prefers-reduced-motion`).

## Local

```
npm install
npm run dev
```

## Deploy to Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`

Installable as a PWA (Add to Home Screen) and works offline once loaded.

## Adding cards from a new worksheet

Andy adds a scan of a worksheet from his son's teacher to `content/`. Turning one into
cards is four steps. **Read this whole section before starting** — step 1 is where the
mistakes happen, and steps 3 and 4 are easy to forget.

### 1. Transcribe the scan

The worksheets are an answer key: vertical Japanese, **columns running right to left**,
each column holding three reading/written pairs (reading on top, written form beneath).
17 columns × 3 = the 51 cards currently in the deck. The footer gives the item count —
check your transcription against it.

Do not read the whole scan at once and trust it. A downscaled view is not good enough to
tell 電車 from でん車, and that exact mistake shipped once. Crop the original at full
resolution and read it in bands:

```python
from PIL import Image
im = Image.open('content/<scan>.jpg')
# Each crop holds one reading row with its written row beneath it.
for i, (top, bottom) in enumerate([(90, 870), (820, 1600), (1550, 2330)]):
    im.crop((120, top, 3120, bottom)).save(f'/tmp/pair{i}.png')
```

Then read each crop. Crop tighter still for any cell you are unsure of.

**The rule that matters most:** transcribe exactly what is printed. These worksheets write
part of a word in kana when that kanji has not been taught yet —

| Printed | NOT |
| --- | --- |
| でん車 | 電車 |
| 全ぶ | 全部 |
| 言ば | 言葉 |
| きょう力 | 協力 |
| りょう方 | 両方 |
| きゅう食 | 給食 |
| 分すう | 分数 |

"Correcting" these to full kanji teaches him something his teacher is not asking for, and
he would be marked wrong for writing it. When in doubt, copy the scan, not your knowledge
of Japanese.

### 2. Add the rows to `content/content.md`

One row per card: `| reading (kana) | written form | meaning |`. The meanings are not on the
worksheet — they are written by hand here, in plain English a ten-year-old would use.

Every reading must be unique across the deck. Two cards sharing a reading would make a
multiple-choice question have two correct answers; `npm run cards` refuses to write if it
finds a duplicate.

If you want to record the full kanji form for reference, put it in 〔…〕 after the written
form — `全ぶ〔全部〕`. The generator strips these, so they never reach the app.

### 3. Regenerate everything

```
npm run cards    # content.md  →  src/cards.js
npm run fonts    # rebuild the Klee One subset for the new characters
npm run audit    # report how guessable the multiple-choice questions are
npm run build    # so the service worker precaches the new font files
```

**`npm run fonts` is not optional.** The bundled font contains only the characters the
cards use. A new kanji that is missing from it falls back to a system font, and on some
devices that fallback is a Chinese face that draws characters like 言 with the wrong
shape — the bug this project already fixed once, reappearing for the new cards only.
It needs network access.

`npm run audit` may list new cards the deck cannot disguise (no other card shares their
ending). That is information, not a failure — see **`npm run audit`** above.

### 4. Check it in the browser

`npm run dev`, then walk the deck in both directions and both modes. Worth confirming:

- every new character renders in Klee One, not a fallback (they look noticeably different)
- the new cards appear, with the right reading, written form and meaning
- nothing overflows vertically at phone size — the app is built to fit without scrolling,
  so check at roughly 412×730 and shorter

## Project layout

| Path | |
| --- | --- |
| `content/content.md` | the card data, hand-maintained — the source of truth |
| `content/*.jpg` | scans of the original worksheets |
| `src/cards.js` | generated from content.md; do not edit by hand |
| `src/choices.js` | card sides and multiple-choice distractor scoring; shared with the audit |
| `src/main.js` | state, screens, rendering, icons |
| `src/style.css` | palettes and all layout; every colour is a token |
| `src/confetti.js` | the clean-sweep animation |
| `public/fonts/` | the Klee One subset, its licence, and regeneration notes |
| `scripts/` | the three `npm run` helpers above |

## Conventions worth keeping

- **Every Japanese string carries `lang="ja"`.** That is what applies the Japanese face, via
  `:root :lang(ja)`. A string without it falls back to a system font.
- **Colours come from tokens only.** Never a literal hex in a component rule — there are
  four palettes × light and dark, and a literal breaks seven of the eight combinations.
- **Never style bare elements inside a container.** This has caused two separate bugs:
  `.menu__panel button { … }` also hit the theme and palette pills that live in that panel,
  overriding their shape, their pill radius and their active fill — the active pill went
  white-on-white on hover. Style a class (`[role="menuitem"]`), not `button`.
- **Watch specificity on state rules.** `.btn:hover:not(:disabled)` out-ranks a plain
  `.btn--secondary:hover`, which once filled the outline button with the same colour as its
  text. A variant overriding a state needs to match that state rule's specificity.
- **Check hover, not just the resting state.** Both of the above were invisible in a
  screenshot. `--primary-hover` must keep `--on-primary` readable: lightening the Matcha
  dark teal for hover dropped its white label to 3.93:1, so that one darkens instead.
- **Correct and wrong are distinguished by shape, not just colour**, and every icon carries
  a text label.
- **The app is sized to fit without scrolling**, using `min(vw, vh)` clamps rather than
  breakpoints. Adding a row to a screen means re-checking the short-phone sizes.
