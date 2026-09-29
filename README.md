# JDLI Kanji Practice

Flashcard PWA for a 5th-grader's kanji homework.

His teacher sends home worksheets of kanji to review; they get transcribed into
`content/worksheets/` and become a set. The school's whole Grade 1–5 kanji list lives alongside them in `content/words/`, one file per grade. He practices on a phone (a Pixel) and an iPad,
usually installed to the home screen, sometimes without a network — which is why this is a
PWA that precaches everything, fonts included.

That one sentence explains most of the decisions below: **it is his homework, so the app
must show exactly what his teacher asks for**, and it must work offline on a phone.

The app opens on a home screen: the title, its English translation, and the three modes.

The translation is a `<p>` inside an `<hgroup>` with the `<h1>`, not an `<h2>`. It is a
translation of the heading, not the title of a section — an `<h2>` would put a phantom
"JDLI Kanji Practice" section containing the mode buttons into the document outline and every
screen reader's heading list. The text is in the DOM either way, which is all a crawler
sees, and the page has exactly one heading.

All three modes share the same round, scoring, progress bar and results screen.

Flash cards and multiple choice also carry a **direction switch**:

- **かな → 漢字** — see the reading, recall the written form (default)
- **漢字 → かな** — see the written form, recall the reading

It is chosen **before the first card**, on the setup screen, and holds for the whole
session. It is not on the home screen, because it has no meaning for the third mode —
Trace always shows the reading and always draws the written form, so a control on the
start page would be inert for whichever mode you were about to pick.

It used to sit above the card and could be flipped mid-round, which rebuilt the
multiple-choice options underneath the question being asked. Setting it once is both
steadier for the person practicing and one control less between the top bar and the card.

### What a round draws from

Everything the app can practice is one flat pool of cards, and a **set** is a named selection from it. A card carries the sets it belongs to; it has no single parent. There are two kinds, and the app cannot tell them apart:

- a **query** set, defined by a card property — Grade 4 is `grade = 4`, so it redefines itself when a new edition of the school's list is ingested, with nothing to maintain;
- a **list** set, an explicit list of written forms — a worksheet, which stays exactly what it was as the curriculum moves underneath it.

Both are resolved at build time into plain membership, so the app never evaluates a query and `npm run check` can verify a set's real contents rather than reimplementing an evaluator.

Sets people make themselves are the third kind, and the only one that is not built. They live in `localStorage`, are merged with the generated manifest at runtime, and travel between devices as a share link — see **Sets people make themselves**. There was once a fourth, `content/sets/*.md`, written by a dev-only builder and shipped inside the bundle; it was removed once anyone could build a set in the app and hand it over with a link, because a set that needs a commit and a deploy is not a set a teacher can make.

The home screen's summary row names the current selection and its card count; tapping it opens a flat picker grouped by where each set came from — **Curriculum**, **Worksheets**, **Kana**, and **My sets** once any exist.

**There is no default selection.** The app used to open on the September review, which is the right answer for exactly one child and the wrong one for everybody else. A student who has never chosen is asked — the picker opens by itself, reading *"What would you like to practice?"*, and cannot be dismissed by the scrim, by Escape, or by its own button until something is picked. After that the app remembers, and returning goes straight to the home screen.

That button says **Confirm**, not Start. It closes the picker and lands on the home screen, where a mode still has to be chosen — it confirms a choice rather than beginning anything.

The same thing happens if a stored selection stops resolving, because a set was renamed or removed: it asks again rather than guessing. That is the one moment the empty-selection rule below is relaxed — on the first run, unticking back to zero is allowed and Confirm disables instead, since refusing to untick something a moment after ticking it would be nonsense.

Grades used to be cut into four **Groups** each. They were a quarter of the master list's *print* order, which is not a teaching order, not a difficulty order, and not tied to when anything is taught — so the boundaries described nothing. They are gone.

Two rules about the selection:

- **It can never be empty.** The handler refuses to clear the last set rather than disabling every mode and explaining why. A round with no cards is simply unreachable.
- **A set with nothing filled in yet reads `not ready` and cannot be picked.** Showing it as `0` would look like a bug; leaving it out would hide that it exists.

It is stored under `kanji-practice:selection` as set ids, **validated against the `SETS` manifest on load**, and old `g4:2`-style group ids are migrated to `g4` rather than dropped — dropping is safe but resets the selection without a word, which reads as the app forgetting. Set ids are content-derived and stable; a card's id is its **written form**, which is this project's identity key everywhere.

### Kana

Two sets, 46 characters each, for students who are not reading kanji yet. They are cards
like any other and need no special handling in a round, but they differ from word cards in
three ways that the code has to know about:

- **The reading is a romaji sound** — `a`, `shi`, `tsu`. Hepburn, with one departure: を and
  ヲ are `wo` rather than Hepburn's `o`. That is what beginner charts teach, and `o` would
  collide with お/オ, which is a real ambiguity rather than a spelling preference.
- **There is no meaning**, and that is not an unfinished row. A kana is a sound, not a word.
  `rowIsFilled(false)` is how a source says so; the two render sites that would otherwise
  draw an empty paragraph check for it.
- **Romaji is not Japanese.** A face declares the language of its own content rather than
  inheriting one from the app being about Japanese, so `shi` is not set in Klee One and not
  announced as Japanese. The direction control follows the same logic: it reads
  「かな → 漢字」 for words and "sound → かな" for kana, because neither half of the first
  names anything on a hiragana card.

### Distractors for a single character

Every distractor signal in `src/choices.js` is derived from the card data — okurigana,
shared kanji, length — and **none of them survive a single character**. `KANJI` never
matches, so the shared-kanji term cannot fire, and `tailOf` returns the whole character,
which makes `isPlausible` reduce to exact equality and score every candidate zero.
Measured: any two hiragana score 3 against each other, with nothing separating one pair
from another. Distractors would be random and the questions free.

What makes two kana confusable is how they *look*, which is not in the data. So `CONFUSABLE`
in `src/choices.js` is the one hand-maintained table in this project: あ/お, ね/れ/わ,
シ/ツ, ソ/ン and the rest. Asked ね, the options are れ and わ every time.

Add to it when a real child confuses a real pair. That is the only evidence worth having.

Note that `npm run audit` reports 0.0% on both directions for a kana set. That is honest
rather than reassuring: the audit measures whether okurigana gives the answer away, and a
single character has no okurigana. It says nothing about whether the kana questions are
hard.

### Keeping the ones you missed

The results screen already knows which words were wrong and already offers to practice them, as a round that evaporates. **Keep these 7 as a set** keeps them.

It is the moment the need actually arises — nobody opens a set builder thinking "I should curate a word list"; they finish a round, miss the same seven again, and want those seven tomorrow. So the naming happens inline, on the results screen: the builder exists to *find* words, and these are already in hand.

The new set is **not** selected. "Practice the N you missed" is the button for doing them now; this one is for having them tomorrow, and changing what someone is practicing mid-results would answer a question nobody asked.

### Making a set

The picker has two tabs. **Practice** is the checkbox list and does one job: choose what to drill, then press Done. **My sets** is the library — make a set, edit one, delete one, and later share one.

They were one list at first, and the split is about rhythm rather than tidiness. Choosing happens every time the app opens and wants to stay two taps however many sets exist; making and tidying happens rarely, takes minutes, and is destructive at the edges. Sharing a footer meant weighing "New set" against "Done" on every visit, and a delete button beside the checkbox you came to press is a mis-tap on a 412px phone.

The tabs are hidden during the first run. Someone who has chosen nothing has one job, and a second tab holding an empty library is a detour away from it.

**New set** opens the builder — a screen, not a third layer, because the picker is already `aria-modal` and a modal inside a modal means two focus traps and an ambiguous Escape. Saving returns to My sets with the new set selected.

The screen is a name, the words chosen so far as removable chips, and a place to find more. **The grid starts empty**: rendering all 839 words is about five thousand elements and shapes 839 Japanese glyphs at once, which stalls a school Chromebook for a screen that shows twelve at a time. Type, or tap a list to browse it. Matches cap at 60 with a "keep typing" line — a query that broad is one to narrow.

The chosen chips are load-bearing rather than decorative. The grid changes under you on every keystroke, so without a running list of what you have picked, *"did I already add 校門?"* is unanswerable.

Search matches the **written form** first, then the reading, then the meaning, and written matches sort ahead of the rest: a child copying a list off a sheet of paper is matching characters. A filter pill narrows the search rather than replacing it, and pressing the active one clears it. There is no All pill — "all" is 839 tiles nobody wants, and search already spans everything.

Every Practice row is a single control, including the user's own. Editing and deleting live on the My sets tab, where a set is a card rather than a row — a name, a word count and two actions. `kind: 'custom'` is what makes a set editable, not the shape of its id. Delete takes two presses, inline on the card; the builder has only Cancel and Save, because a destructive button inside an editor you are halfway through is worse than one in a management view.

**A set edited down to no words cannot be saved.** Otherwise `isPlayable` starts returning false for a set that is currently selected, and the summary row and the round quietly disagree. **Deleting the only selected set** leaves the state the app reads as "has never chosen", which already has an answer: it asks again.

### Sharing a set

The share icon on a set's card opens a screen with a **QR code**, the link as selectable text, Copy, and Send where `navigator.share` exists.

The QR is the point rather than a flourish. A teacher sending a link to thirty students needs thirty addresses, and children this age mostly do not have email; a teacher putting a QR code on the smartboard needs nothing at all. It is always drawn on white — a QR inverted for dark mode does not scan — which makes it one of two places in the app that is not a palette token, and it is a picture of data rather than part of the interface.

The link carries **references, not cards**: every copy of the app already has the words, so a link only says which ones. A thirty-word test list is 267 characters including the address. It lives in the fragment, so the payload never reaches the server or its logs.

`src/share.js` encodes it as `<version>.<name>.<words>`, both halves base64url, the words deflated where `CompressionStream` exists and plain where it does not. The version leads so a link made by a later format is recognised and refused rather than mis-read into the wrong words.

**A truncated link is the failure mode worth designing for.** Messaging apps wrap long URLs, and a half payload that still inflated would save a silently short word list — the worst outcome available. Deflate fails on truncation, so it is caught; exercised against a cut link, a mangled one, a missing part and a future version.

The QR encoder is loaded on demand, so it is its own 21 KB chunk rather than part of the app's first parse. It is still precached, because a teacher on bad school wifi is exactly who needs it to work offline.

### Opening a shared set

A link opens a screen showing who it is from, the name, the count and **the words themselves**, with Save and Not now. Nothing is written until the person agrees — a link from outside the app is untrusted input, and the words are the thing: "Week 3 test, 30 words" tells you nothing, while seeing こん立て tells you whether it is the right list.

The fragment is read once and removed from the address bar immediately, because `applyUpdate()` reloads the page to install a new service worker and a reload preserves the fragment. Without that, the same link would be offered again after every update. A link opened while the app is already on screen changes the fragment without reloading, so `hashchange` is handled too.

Four states that are designed rather than discovered:

- **A brand-new student opens a link.** The set beats the first-run picker — it is why they opened the app, and saving it satisfies the same requirement the picker exists to enforce. Declining still lands them on the picker, because they have then chosen nothing.
- **Their app is older than the sender's.** The words that do not resolve are shown struck through and the button reads *Save these 9*. Quietly saving 9 of 12 is how a child sits a test missing three words nobody knows about.
- **They already have it**, matched on contents rather than name — the same list forwarded twice is the same set whatever it got called. It says so and offers to open the one they have.
- **The link arrived truncated.** Messaging apps wrap long URLs; deflate fails on a half payload, so it says the link looks incomplete rather than saving a short word list.

> **Known gap: iOS Home Screen.** iOS partitions storage between Safari and an installed home-screen web app — session, cookies, `localStorage` and the service worker are all separate. A link tapped in Messages opens in Safari, saves there, and the installed app cannot see it. This works everywhere else: any desktop browser, Android installed, and iOS in Safari. There is an undocumented Cache Storage bridge that may work around it; it is not built, because it cannot be tested without an HTTPS deploy and an iPad.

### One card per written form

A word that appears under a grade and again on a worksheet is **one card in two sets**, not two cards. Before that was true, the same word held two separate scores and could appear in both results lists at once, and neither copy excluded the other from being its own distractor. Selecting both sets therefore deals the union, not the sum.

The app currently ships only the grade files and the kana, so nothing overlaps and the rule has nothing to do — it is the guard the next worksheet lands on. The one worksheet that did ship, a September review, overlapped 47 of its 51 words with the grades; it was removed along with the built-time practice sets, so that out of the box the app is the school's curriculum and nothing else. The four words only it defined (鳥, でん車, 休み, 北と南) took no kanji with them: every character survives in the grade lists, and でん車 has a near-twin in Grade 3's てん車.

### Setting up a session

Between choosing the words and the first card there is one screen asking how this sitting
should work: **which way round**, and **how much at a time**.

Both belong to the sitting rather than to the selection — how much time someone has
tonight is not a stable answer, and neither is whether they feel like reading or recalling
— so both are asked every time rather than remembered.

The screen appears when there is something to ask. Direction, if the mode has one; round
size, if the selection is long enough for it to matter. Trace on a short set has neither
and starts straight away. Below about forty cards the length question does not appear,
because a checkpoint after twenty of twenty-six is an interruption rather than a kindness.

Asking beats configuring here: "226 cards" reads very differently from "Grade 5", and
*eleven rounds* is a shape a size control alone never shows.

A **session** is one pass through the selection, **shuffled once** and dealt out in order. That is the whole difference from the cap that was tried and removed: a few short rounds cover the selection *exactly once*, where a cap re-sampled it at random every round and never guaranteed a card was seen at all. Verified by playing a full Grade 5 session — 226 cards dealt, 226 distinct.

Rounds are a fixed size, except that a tail shorter than half a round is folded into the one before it. "Round 12 of 12 · 1 card" is a checkpoint for nothing, so 226 at 20 is eleven rounds, the last of 26.

**The checkpoint** between rounds carries how the round went, where the session has got to, and three ways out: the next round, another go at what was just missed, or going home. The session line is the point — *Round 2 of 11* is a promise that this ends, and without it a checkpoint is an interruption that keeps happening.

**The next round is the bottom button, and that is a safety decision rather than a typographic one.** During a round the ✓ and ✗ buttons sit in this same strip, so whatever lands at the bottom is where a thumb already is, and answering three cards in a rhythm should not be able to end the session. The harmless action takes that spot and leaving is one row up — measured at 412×730, the exit moved from 13px away from the judge buttons to 75px.

The pace screen's two options **choose** rather than start; `Let's go!` at the foot starts. A screen whose first element begins the thing gives no moment to read the second one.

A retry does **not** advance the session; it comes back to the same checkpoint, still offering the next round. And the score shows both figures: the dial is where they have got to, while *first try 16 of 20* is the honest number a retry cannot move.

Counts follow the round rather than every card that exists — the tally, the progress bar, the score ring — because **Practice the N you missed** plays a subset, and scoring that against everything would report "7 of 747".

### Flash cards

Prompt → tap **Show answer** → the other side plus the meaning → tap ✓ or ✕, which scores
the card and advances. Self-marked.

### Multiple choice

Prompt plus three options — the right answer and two distractors.

Distractors come from the **active selection**, because a wrong answer is only convincing
if it is something he is actually studying. Below `MIN_POOL` (8) cards the pool widens to
the card's whole grade: a set can be small, and at that size the correct
option is often the only one whose okurigana fits the prompt, which is answerable without
reading any kanji at all. `npm run audit` measures exactly that, per set.

With the Groups gone the smallest generated set is 30 cards, so the widening cannot fire on any of them. It stays for the sets people make themselves, which can be any size — a set of the seven words you keep missing is exactly the case it exists for.

`buildChoices` also refuses any candidate whose **prompt** face matches the question's, not
just its answer face. Asked こう with 校 correct, 高 is a different answer and an equally
correct one. No build-time rule over `content/` can cover this: 54 readings collide across
the curriculum, the pool widens across sets, and practice sets could add more. The
runtime exclusion is the guarantee.
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
practice and coloring in.

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
`npm run fonts` subsets the typeface.

**Rounding a path is not a search and replace.** In SVG path data a minus sign is also a
separator — `0.8-0.05` is two numbers, not one — so a negative that rounds to zero loses
the sign holding it apart from its neighbour and the two silently merge into `0.80`. That
shipped once and corrupted 48 strokes across 25 of the 79 characters. The browser refused
the malformed paths, so 日 drew as ヒ, 本 as 六, 生 as 土 and 会 as 今, and because a
rejected path measures zero length the matcher turned down every attempt at those strokes
forever. The generator now tokenises the numbers and re-emits them with an explicit comma
wherever the next one does not begin with a minus, and then checks every command has a
whole number of arguments and throws if not, so this cannot ship quietly again. The current deck is 79 characters and 403 strokes —
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
| `npm run cards` | `content/worksheets/` + `content/words/` → `src/cards.js` |
| `npm run fonts` | rebuild the Klee One subset for the current cards (needs network) |
| `npm run strokes` | rebuild the KanjiVG stroke subset for the current cards (needs network) |
| `npm run check` | confirm the generated files still match `content/` |
| `npm run audit` | how guessable the multiple-choice questions are, per set (`npm run audit -- g4` for one) |
| `npm run scaffold` | regenerate `content/words/*.md` from the master kanji list |

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

### 2. Add the rows to the worksheet file in `content/worksheets/`

One row per card: `| reading (kana) | written form | meaning |`. The meanings are not on the
worksheet — they are written by hand here, in plain English a ten-year-old would use.

Every reading must be unique **within a set**. Two cards sharing a reading would make a multiple-choice question have two correct answers; `npm run cards` refuses to write if it finds a duplicate inside one set.

Most apparent duplicates are not duplicates: they are one word re-taught as more of its kanji become available — 小いし then 小石, こう校 then 高校, か学者 then 科学者. Those are recognised rather than listed, because the pattern is in the data: the two forms are the same word, so one form's kanji are a subset of the other's. What survives that rule is a genuine homophone, and there is exactly one — 二本 and 日本 are both にほん and both grade 2, and their kanji have nothing in common. It is named in `ALLOWED_COLLISIONS` in `scripts/deck.mjs`.

Across sets a shared reading is fine, and is in fact the syllabus: the same word is re-taught as more of its kanji become available, so じどうしゃ is legitimately じどう車, 自どう車 and 自動車. 54 readings span more than one set. A round draws from one selection, and `src/choices.js` refuses a distractor whose prompt face matches the question's, which is the guarantee that actually holds at runtime.

The same thing happens *inside* a grade — 画用紙 is printed twice in the master list as が用紙 under 紙 and が用し under 用, both verified against the scan — and those are allowed by the nesting rule above rather than being named or "fixed".

If you want to record the full kanji form for reference, put it in 〔…〕 after the written
form — `全ぶ〔全部〕`. The generator strips these, so they never reach the app.

### 3. Regenerate everything

```
npm run cards    # content/worksheets/ + content/words/  →  src/cards.js
npm run fonts    # rebuild the Klee One subset for the new characters
npm run strokes  # rebuild the KanjiVG stroke subset for the new characters
npm run check    # confirm the three above actually agree with each other
npm run audit    # report how guessable the multiple-choice questions are
npm run build    # so the service worker precaches the new font and stroke files
```

**`npm run check` is the one that catches you.** `fonts` and `strokes` both fail silently
if you skip them — a new kanji missing from the font subset falls back to a system face,
which on some devices draws Chinese shapes, and a character missing from the stroke data
simply cannot be traced, so Trace mode passes over it without a word. Neither shows up in
a build, and both are the kind of mistake that looks like nothing is wrong.

Being written down here was not enough: the font one shipped anyway. So `npm run check`
re-reads every deck under `content/`, compares them to `src/cards.js`, and confirms every character in the
deck has both a glyph in the font subset and well-formed stroke data. It writes nothing
and names the command that fixes whatever it finds:

```
2 problems:

  No stroke data for 郵 便 — Trace mode skips them silently.
    fix: npm run strokes

  Not in the font subset: 郵 便 — they fall back to a system face, which on some
  devices draws Chinese shapes.
    fix: npm run fonts
```

`fonts` and `strokes` both need network access.

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

- **`npm run check`** — confirms the generated files still match the deck: `src/cards.js`
  against `content.md`, and every character against the font subset and the stroke data.
  This is the one that catches a regeneration step you forgot.
- **`npm run audit`** — reports how guessable the multiple-choice questions are.
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
| Stroke data corrupted by rounding — 日 drawn as ヒ | Reading the generator, where the rounding looks fine |

So when changing anything visual, check the actual numbers: contrast in all eight
palette × theme combinations, page overflow at ~412×730 and shorter, and hover states —
not just the resting state.

## Project layout

| Path | |
| --- | --- |
| `content/worksheets/*.md` | a worksheet as the teacher sent it home — one deck each |
| `content/words/*.md` | the school's master list, one file per grade; readings and meanings hand-written |
| `content/kanji-list/` | the transcribed master list, one directory per edition; `current` names the active one |
| `content/*.jpg` | scans of the original worksheets |
| `src/cards.js` | generated from `content/`; exports `cards` and the `SETS` manifest. Do not edit by hand |
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
| `scripts/deck.mjs` | parses card tables and set files; shared by `npm run cards` and `npm run check` so they cannot disagree |
| `scripts/` | the `npm run` helpers above |
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
| One breakpoint, for the mode cards only | 1 column to 3 at 44rem. `flex-wrap` always passes through a lopsided 2 + 1 on the way, for any card width; a column count is discrete and a clamp cannot express it. |
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
- **No romaji on word cards.** A word's reading is kana. This used to read "no romaji
  anywhere", and was narrowed deliberately when the kana sets were added: for a child
  learning あ, the sound *is* the lesson rather than a crutch to lean on, and there is
  nothing else a kana card's reading could be. Word cards are unchanged — no `jitensha`,
  ever.

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
