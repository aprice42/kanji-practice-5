# Kanji Practice

Flashcard PWA for a 5th-grader's kanji homework.

His teacher sends home worksheets of kanji to review; they get transcribed into
`content/content.md` and become the deck. He practises on a phone (a Pixel) and an iPad,
usually installed to the home screen, sometimes without a network — which is why this is a
PWA that precaches everything, fonts included.

That one sentence explains most of the decisions below: **it is his homework, so the app
must show exactly what his teacher asks for**, and it must work offline on a phone.

The app opens on a home screen: the title, its English translation, and the three modes.

The translation is a `<p>` inside an `<hgroup>` with the `<h1>`, not an `<h2>`. It is a
translation of the heading, not the title of a section — an `<h2>` would put a phantom
"Kanji Practice" section containing the mode buttons into the document outline and every
screen reader's heading list. The text is in the DOM either way, which is all a crawler
sees, and the page has exactly one heading.

All three modes share the same deck, scoring, progress bar and results screen.

Flash cards and multiple choice also carry a **direction switch**:

- **かな → 漢字** — see the reading, recall the written form (default)
- **漢字 → かな** — see the written form, recall the reading

It sits inside those two rounds and **not on the home screen**, because it has no meaning
for the third mode — Trace always shows the reading and always draws the written form, so
a control on the start page would be inert for whichever mode you were about to pick.

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

### Trace

The reading is the prompt, as in かな → 漢字, but recalling the written form means drawing
it. **Nothing shows the answer until he asks for it.** The cell starts blank and the strip
above it shows one dashed box per character — the length of the word and which character
he is on, but not what they are. **Show me** toggles: it fades in a grey ghost of the
character, animates the current stroke drawing itself, and uncovers that character in the
strip; pressing it again ("Hide it") puts both back so he can have another run from
memory. A character he has finished drawing stays visible — he has earned it — and the
reveal resets for each new character.

Asking for the answer being a deliberate, reversible act is the whole difference between
practice and colouring in.

Each stroke is checked as it is finished: right stroke, right place, right direction,
right order. Accepted strokes ink in and the character builds up; a rejected one flashes
and is retried. A card scores correct if it was finished with **no more than two** rejected
strokes across the whole word — one slip should not cost the card — and after three
failures on a single stroke the guide replays and the tolerance drops, so he is never
stuck. **Skip this one** is always available and scores the card wrong.

Multi-character words show that strip above one large cell at a time. Four characters side by side would give
~85px cells on a phone; a fingertip covers about 40px, so his finger would hide the guide
he is meant to be following.

#### Stroke data

From **KanjiVG** (`http://kanjivg.tagaini.net`), **CC BY-SA 3.0** — see
`public/KANJIVG-LICENSE.txt` and the credit at the foot of the Trace screen, which is the
one screen whose content is derived from that data. Note this is share-alike, unlike
the font's OFL: `src/strokes.js` is a derived work under the same licence.

`npm run strokes` fetches one SVG per character and keeps only the path data, exactly as
`npm run fonts` subsets the typeface. The current deck is 79 characters and 403 strokes —
30 KB, bundled into the app JS, so there is no runtime fetch and it works offline. All 79
are present in KanjiVG, including the small kana the worksheets force (ッ ょ ゅ).

#### How forgiving it is

`src/trace-match.js` scores six things in **glyph units** (the 0–109 box the data is
authored in, never pixels, so a tolerance means the same thing at every cell size): start
point, end point, mean and worst deviation, direction, and length ratio. All six must pass.

Each catches something the others cannot. Direction is what makes this stroke *order*
rather than shape matching — without it, 一 drawn right to left passes. Start point is the
only thing separating the three horizontals of 三.

**Dots get their own branch and it matters.** Strokes under 16 units — the two 点 of ッ,
the dakuten — are judged on position alone. At that scale direction is hand jitter and
length is meaningless, because a child taps rather than drags and produces a single point.
About 40 of the 403 strokes take this path. If Trace mode ever starts insisting he is wrong
when he is not, look here first.

Trackpad and finger are also branched on `pointerType`: on a trackpad he cannot see his
hand against the target so he starts in the wrong place but draws smoothly; with a finger
he lands accurately, then wobbles, and the finger covers the guide.

**A known limit.** The two dakuten dots of ド sit 8 glyph units apart, and the dot
tolerance is 16 — so tapping them in the wrong order is accepted. This cannot be fixed by
tightening the tolerance: 8 units is about a third of a fingertip at the cell sizes used,
so a threshold tight enough to tell them apart would reject correct taps everywhere else.
Accepted deliberately.

The thresholds are a starting hypothesis tuned by watching someone trace, not a
derivation. `?trace=debug` logs all six metrics per stroke and is the way to retune them.

### Menus

Two popovers in the top bar, not one:

- **☰ on the left — navigation.** The other two exercises (switching restarts the round in
  the new one), **Start over**, **Home**.
- **⚙ on the right — settings.** Theme and color scheme.

They were a single ☰ panel until it had grown to hold three exercises, two switches, start
over, home and a licence credit — at which point "menu" had stopped describing it and
nothing in it was findable. Splitting on *where do I go* versus *how does it look* also
puts something in the top bar's empty right-hand slot, which the tally was being centred
against by a spacer.

The gear is on **every** screen including the home screen, always in the same place — same
coordinates on home, in all three exercises and on the results page, so it is somewhere to
reach for rather than something to look for. The hamburger only appears once there is a
round to navigate away from.

Theme and color scheme used to be laid out in the home screen's own content as well, which
meant two implementations of the same controls kept in sync, and a start page whose bottom
half was settings rather than the thing you came to do. They now live in the gear only.

Both popovers are built by the same `popover()` helper and bound by one `bindMenus()`, so
they cannot drift apart: opening one closes the other, and each closes on Escape or an
outside click. The settings panel opens leftwards (`.menu--end`) or it would run off the
screen edge.

The exercise list is built from `MODES`, not hardcoded — it used to offer "the other mode",
which only worked while there were exactly two.

### Theme and color scheme

Both live behind the ⚙ gear, on every screen. **Auto / Light / Dark** — Auto follows the
device setting, Light and Dark override it.

**Color scheme**, four options, default Indigo:

| Scheme | Primary | Correct | Wrong |
| --- | --- | --- | --- |
| Indigo (藍と柿) | indigo | moss | persimmon |
| Ink (墨と朱) | sumi charcoal | bamboo | vermilion |
| Matcha (抹茶) | teal | olive | terracotta |
| Plum (梅と柚子) | plum | leaf | clay |

Each is a complete token set for light and dark, validated so text pairs clear 4.5:1,
control edges clear 3:1, and the primary / correct / wrong hues stay at least 48° apart so
no two roles read as the same color. None use pure white or black grounds.

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
sparkle for a clean sweep, a glyph for each of the three exercises, and one for every other
item the menus offer — a gear for settings, a house for Home, a circular arrow for Start
over. Every row in a menu carries one, so none of them reads as an afterthought.

The gear and the Start over arrow are **generated**, not hand-placed: the gear so its eight
teeth sit at even angles, the arrow so its head lands tangent to the arc end rather than
approximately near it. The one-liners that emit them are in the git history of this change. Correct and wrong are
distinguished by shape as well as color, and each carries a text label for screen readers.

### Results

The tally at the top carries the score at display size, under it a line of encouragement
chosen by percentage correct — **Good job!** (≤25%), **Great work!** (≤50%), **Almost
there!** (≤95%), **So close!** (95–99%), **You did it!** (100%) — then a table of the missed cards
and a table of the correct ones (reading + written form). The column headers are present
for screen readers but hidden visually — the two columns are obvious by script. Two
buttons: **Practice the N missed** — another round with just those — and
**Start over**. Getting a card right on a retry flips it from missed to correct, so the
score climbs toward a clean sweep.

Every finished round gets confetti, scaled in six steps that grow as the score crosses
25 / 50 / 75 / 95 / 100 percent — only a clean sweep gets the full barrage. Skipped
entirely for `prefers-reduced-motion`. The message and the confetti level come from the
same band in `celebrationFor()` in `src/main.js`.

## Local

```
npm install
npm run dev
```

| Command | |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve the built output, to check the service worker and offline behaviour |
| `npm run cards` | `content/content.md` → `src/cards.js` |
| `npm run fonts` | rebuild the Klee One subset for the current deck (needs network) |
| `npm run strokes` | rebuild the KanjiVG stroke subset for the current deck (needs network) |
| `npm run audit` | how guessable the multiple-choice questions are |

## Deployment

Deployed as a **Cloudflare Worker serving static assets** — not Cloudflare Pages, despite
the name similarity. `wrangler.jsonc` points at Vite's `dist/` output and sets
`single-page-application` fallback so a bookmark or PWA launch to any path still loads.

**Pushing to `main` deploys it.** Cloudflare Workers Builds watches the GitHub repo and
runs `npm run build` then `npx wrangler deploy` on its own. There is no GitHub Actions
workflow, and adding one would duplicate the builds.

To deploy by hand (needs `npx wrangler login` first):

```
npm run build && npx wrangler deploy
```

Run that from the project directory. From the parent folder wrangler will not find
`wrangler.jsonc`, will invent a Worker name from the directory, and will publish the
unbuilt source.

If a push does not deploy, check **Workers & Pages → kanji-practice-5 → Settings → Build**
for a "disconnected from your Git account" banner — the GitHub authorization has lapsed
before, and the build config itself was fine.

The app installs to the home screen and works offline once loaded.

### Getting an update onto his phone

Because the service worker precaches everything, a deploy is invisible to an already
installed copy until the worker is replaced. That used to happen on its own
(`registerType: 'autoUpdate'`), which meant it could happen mid-round — the page
reloading between two cards.

It is now `prompt`: a new worker installs and waits. `src/update.js` asks the browser to
look for one every time the home screen renders, and when one is waiting the home screen
grows an **Update the app** button above the mode cards. Tapping it activates the waiting
worker and reloads onto it. Nothing interrupts a round in progress, and the button is not
shown anywhere except the home screen.

Two things worth knowing if you touch this:

- The generated worker never calls `clients.claim()`, so activating it does **not** make it
  take over the open page and no `controllerchange` event fires. `vite-plugin-pwa`'s own
  `updateSW(true)` waits for exactly that event, so it sends the skip-waiting message and
  then never reloads — the update applies but the screen does not change. `applyUpdate()`
  in `src/update.js` watches the new worker reach `activated` and reloads itself instead.
- The check needs the network, so offline it simply finds nothing. That is the normal case
  on his phone and is swallowed deliberately.

Testing it needs the built output, not the dev server: `npm run build && npm run preview`,
load it, rebuild with a visible change, reload once, and the button should appear.

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
npm run strokes  # rebuild the KanjiVG stroke subset for the new characters
npm run audit    # report how guessable the multiple-choice questions are
npm run build    # so the service worker precaches the new font and stroke files
```

**`npm run strokes` is not optional either**, for the same class of reason: a character
with no stroke data cannot be traced, and Trace mode silently passes over it. The script
warns and keeps going rather than failing the build, so nothing tells you except the mode
skipping that character.

**`npm run fonts` is not optional.** The bundled font contains only the characters the
cards use. A new kanji that is missing from it falls back to a system font, and on some
devices that fallback is a Chinese face that draws characters like 言 with the wrong
shape — the bug this project already fixed once, reappearing for the new cards only.
It needs network access.

`npm run audit` may list new cards the deck cannot disguise (no other card shares their
ending). That is information, not a failure — see **`npm run audit`** above.

### 4. Check it in the browser

`npm run dev`, then walk the deck in both directions and all three modes. Worth confirming:

- every new character renders in Klee One, not a fallback (they look noticeably different)
- the new cards appear, with the right reading, written form and meaning
- they are traceable — a character missing from `src/strokes.js` is silently skipped
- nothing overflows vertically at phone size — the app is built to fit without scrolling,
  so check at roughly 412×730 and shorter

## How this gets verified

**There is no test suite.** Nothing here is covered by a test framework, and for an app
this size with no backend that has been a reasonable trade. Verification happens two ways:

- **`npm run audit`** — the only scripted check. Reports how guessable the
  multiple-choice questions are.
- **Driving the real app in a browser** — open `npm run dev`, walk the deck, and measure
  the DOM directly (computed styles, contrast ratios, element geometry).

That second one is not busywork; it has caught every bug in this project that mattered,
and several were invisible in a screenshot:

| Found by measuring | Would not have been found by |
| --- | --- |
| Buttons unreadable on hover (two separate causes) | Looking at the page — hover is not in a screenshot |
| The results page scrolling 184px | Looking at a tall desktop window |
| Multiple choice answerable without reading kanji | Playing a few rounds by hand |
| A kanji rendering in a Chinese font | Reading the source, where it looks correct |

So when changing anything visual, check the actual numbers: contrast in all eight
palette × theme combinations, page overflow at ~412×730 and shorter, and hover states —
not just the resting state.

## Project layout

| Path | |
| --- | --- |
| `content/content.md` | the card data, hand-maintained — the source of truth |
| `content/*.jpg` | scans of the original worksheets |
| `src/cards.js` | generated from content.md; do not edit by hand |
| `src/choices.js` | card sides and multiple-choice distractor scoring; shared with the audit |
| `src/strokes.js` | generated from KanjiVG by `npm run strokes`; do not edit by hand |
| `src/strokes-geom.js` | sampling and `Path2D` for the stroke data |
| `src/trace-match.js` | whether a drawn stroke traced the right one |
| `src/trace.js` | Trace mode's canvas, pointer handling and stroke queue |
| `src/main.js` | state, screens, rendering, icons |
| `src/style.css` | palettes and all layout; every color is a token |
| `src/confetti.js` | the clean-sweep animation |
| `src/update.js` | service-worker update check behind the home screen's update button |
| `public/fonts/` | the Klee One subset, its licence, and regeneration notes |
| `scripts/` | the three `npm run` helpers above |
| `wrangler.jsonc` | Cloudflare deploy config — points at `dist/` |
| `CLAUDE.md` | short orientation for an agent picking this up |

## Decisions already settled

Each of these was a deliberate choice with a reason; the detail is in the section named.

| Decision | Why |
| --- | --- |
| No framework, no backend, no build beyond Vite | One kid, a phone and an iPad, 51 cards. The whole app is five files in `src/`. |
| Card data in Markdown, generated into JS | Andy edits a table, not JavaScript. See **Adding cards**. |
| Written forms copied literally from the worksheet | でん車, not 電車 — the full kanji is not what his teacher is asking for. |
| Klee One, self-hosted and subset | Guarantees Japanese glyph shapes and works offline. See **Typeface**. |
| Icons as inline SVG, no emoji | Emoji carry fixed colors that ignore the palette. See **Icons**. |
| Four palettes behind CSS tokens | See **Theme and color scheme**. |
| Distractors scored, not random | Otherwise most cards are answerable without reading. See **Choosing distractors**. |
| Sized to fit a phone without scrolling | `min(vw, vh)` clamps rather than breakpoints. |
| Capped at 1080px and centred on wide screens | Everything inside is clamped, so past that width the app only spreads its corners further apart. |
| Direction lives in the round, not on the home screen | It is meaningless for Trace. See the mode list at the top. |
| Settings behind a gear on every screen, not laid out on the home screen | One implementation instead of two kept in sync, and a start page that is only the thing you came to do. See **Menus**. |
| Stroke data subset from KanjiVG at build time | Same trick as the font: 30 KB for this deck instead of megabytes. See **Trace**. |
| Updates offered on a button, not applied automatically | `autoUpdate` could reload the page mid-round. See **Getting an update onto his phone**. |

## Non-goals

Things deliberately not built. Worth asking before adding any of them:

- **No accounts, no sync, no backend.** Progress is per-session; theme and palette are the
  only things persisted, in `localStorage`.
- **No spaced repetition or long-term progress tracking.** The retry loop ("Practice the N
  missed") is the whole learning mechanic.
- **No analytics.**
- **No free handwriting recognition.** Trace mode checks a drawn stroke against a known
  target, which is a much smaller problem. Reading back an arbitrary character he wrote
  unaided is not something this app attempts, and the deck's mixed kana/kanji forms
  (でん車) would make it unreliable anyway. *This entry used to read "no stroke-order
  practice or handwriting input — he writes on paper; this is recall", and was overturned
  deliberately when Trace mode was added: writing the characters is half the homework, and
  the app already owned the deck and the scoring.*
- **No romaji anywhere.** Readings are kana.

## Conventions worth keeping

- **Every Japanese string carries `lang="ja"`.** That is what applies the Japanese face, via
  `:root :lang(ja)`. A string without it falls back to a system font.
- **Colors come from tokens only.** Never a literal hex in a component rule — there are
  four palettes × light and dark, and a literal breaks seven of the eight combinations.
- **Never style bare elements inside a container.** This has caused two separate bugs:
  `.menu__panel button { … }` also hit the theme and palette pills that live in that panel,
  overriding their shape, their pill radius and their active fill — the active pill went
  white-on-white on hover. Style a class (`[role="menuitem"]`), not `button`.
- **Watch specificity on state rules.** `.btn:hover:not(:disabled)` out-ranks a plain
  `.btn--secondary:hover`, which once filled the outline button with the same color as its
  text. A variant overriding a state needs to match that state rule's specificity.
- **Check hover, not just the resting state.** Both of the above were invisible in a
  screenshot. `--primary-hover` must keep `--on-primary` readable: lightening the Matcha
  dark teal for hover dropped its white label to 3.93:1, so that one darkens instead.
- **Correct and wrong are distinguished by shape, not just color**, and every icon carries
  a text label.
- **The app is sized to fit without scrolling**, using `min(vw, vh)` clamps rather than
  breakpoints. Adding a row to a screen means re-checking the short-phone sizes.
