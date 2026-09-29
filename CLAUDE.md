# JDLI Kanji Practice

A flashcard PWA for kanji practice. It started as one 5th-grader's homework, built from
worksheets his teacher sends home; it now ships the school's Grade 1-5 curriculum and the
kana and nothing child-specific, so any student in the program can use it out of the box. Read `README.md` before changing anything — particularly **Decisions already
settled**, **Non-goals** and **How this gets verified**. Several choices here look
arbitrary and are not.

There is no test suite. Visual and layout changes are verified by driving the app in a
browser and measuring the DOM — contrast across all eight palette × theme combinations,
page overflow at phone height, and hover states. Every bug that mattered in this project
was found that way and would have been missed by looking at a screenshot.

## If you are here to add cards from a worksheet scan

Follow **Adding cards from a new worksheet** in `README.md` exactly. The two things that
have gone wrong before:

1. **Transcribe the scan literally.** The worksheets deliberately write part of a word in
   kana when that kanji has not been taught yet — でん車, not 電車. Read the scan at full
   resolution in crops; a downscaled view cannot be trusted for this.
2. **Run `npm run fonts` and `npm run strokes` afterwards, then `npm run check`.** Both
   subsets cover only the characters the cards use. A kanji missing from the font falls
   back to a system font, which on some devices renders Chinese glyph shapes; a kanji
   missing from the stroke data cannot be traced, and Trace mode passes over it without
   saying so. Neither failure shows up in a build — `npm run check` is what catches them,
   and it names the command that fixes each one. Run it before you call the job done.

## Deploying

Pushing to `main` deploys it — Cloudflare Workers Builds watches the repo. It is a Worker
serving static assets, configured in `wrangler.jsonc`, not Cloudflare Pages.

## Commands

    npm run dev      # local dev server
    npm run cards    # content/ → src/cards.js
    npm run scaffold # master kanji list → content/words/*.md
    npm run fonts    # rebuild the Klee One subset (needs network)
    npm run strokes  # rebuild the KanjiVG stroke subset (needs network)
    npm run check    # generated files still match content/ — run after adding cards
    npm run audit    # how guessable the multiple-choice questions are, per set
    npm run build    # production build into dist/

## House rules

- `content/worksheets/*.md` and `content/words/*.md` are the source of truth. `src/cards.js`
  (both `cards` and the `SETS` manifest), `src/strokes.js` and `public/fonts/` are all
  generated from them, and `npm run check` is what proves they still agree — the generators
  only validate their own output, not each other's. `src/strokes.js` comes from KanjiVG,
  CC BY-SA — attribution is required, and lives at the foot of the Trace screen.
- One card per written form. A word in Grade 4 and also on a worksheet is one card in two
  sets. A card's `id` IS its written form — never an array index.
- A reading must be unique within a set, not across them: a word is re-taught as more of
  its kanji arrive. A collision whose two forms have nested kanji sets is that re-teaching
  and is allowed automatically; anything else fails the build. Set ids (`g4`,
  `w:2025-09-review`, `k:hiragana`) are content-derived and safe to persist. The `w:`
  shape is reserved for the next worksheet; none ships today.
- Kana cards (`content/kana/*.md`) have a romaji reading and NO meaning. A meaning is
  required per source, not globally — `rowIsFilled(false)`. Romaji faces must not carry
  `lang="ja"`; `ja(text)` in main.js decides that from the content, not from the field.
- Multiple-choice distractors for single kana come from the hand-written `CONFUSABLE` table
  in `src/choices.js`. Every other distractor signal is shape-based and scores zero on one
  character, so without that table kana questions are random.
- Hand-picked sets are NOT content. There is no `content/sets/`, no dev builder and no
  "Practice sets" section: a set that needs a commit and a deploy is not one a teacher can
  make. Sets are built in the app and handed over as a link. Do not reintroduce a
  build-time set format — the app-side path is the whole feature.
- Class names are shared across screens, so CHECK BEFORE ADDING ONE. `.pill` already
  belonged to the set builder's grade filters; reusing it for the flow's summary pill made
  every filter a full-width 44px row and collapsed the word grid to nothing on a phone. The
  flow's is `.summary`. `grep -n '^\.name' src/style.css` before naming anything.
- Home's title is tategaki — `writing-mode: vertical-rl` — and is sized from its container
  with `cqh`, not from the viewport. Two traps, both hit: vertical text WRAPS INTO A SECOND
  COLUMN when it runs out of height (`white-space: nowrap`), and `container-type: size`
  means the contents cannot set the box, so the container needs an explicit width and a
  definite flex basis or every `cq` unit resolves to zero. Also `palt` is horizontal-only;
  the vertical counterpart is `vpal`.
- Everything in the flow shares ONE column, `--col` on `#app`. Four different widths were
  on screen at once before that rule existed — a 372px list over a 352px pace block over a
  256px button — and the panes read as a pile of unrelated boxes rather than one column of
  questions. Anything new on a pane fills the column; nothing carries its own max-width.
- Every Japanese string needs `lang="ja"` — that is what applies the Japanese typeface.
- Colors come from CSS tokens only. Four palettes × light and dark; a literal hex breaks
  seven of the eight combinations.
- The app is sized to fit a phone without scrolling. If you add a row to a screen, re-check
  at ~412×730 and shorter. It is capped at 1080px and centred above that, so also check a
  desktop width — and a phone held landscape, which is as wide as a tablet and half as
  tall. That is why chrome that grows with the viewport is gated on `min(vw, vh)`, not `vw`.
- There is exactly one layout breakpoint (the mode cards, 1 column to 3 at 44rem) and it is
  deliberate: a column count is discrete and a clamp cannot express it. Sizes stay clamps.
- Correct/wrong must differ by shape, not only color, and every icon needs a text label.
- The bottom of `.actions` is where the ✓/✗ buttons sit during a round, so nothing that
  ends or discards anything may be the bottom button on a screen that follows one. Put the
  harmless action there.
- A shared link carries written forms, not cards, and lives in the URL fragment. A
  truncated link must fail loudly — deflate catches it — never save a short word list.
  Sharing does NOT work for an iOS app installed to the Home Screen: storage there is
  partitioned from Safari, which is where the link opens. Documented, not solved.
- Setting a session up is a FLOW OF PANES, not a dialog and not a screen swap: Home → sets
  → format → settings → the first card, with manage-my-sets as a detour off step one. The
  header is the one thing that does not move, which is what makes four panes read as one
  place asking four questions. `flowSteps()` decides how many steps this session has, so
  the rail and the Next/Let's go! label cannot disagree.
- Nothing inside a scrolling list calls `render()` — that rebuilds the list and resets its
  scroll, sending someone who scrolled down back to the top on every tap. Swap the rows
  with `syncSets()`, `refreshLibrary()` or `syncChosen()` and re-bind with `bindSetList()`,
  `bindLibrary()` or `bindChips()`. The builder's search box is the one deliberate
  exception: it changes which words the grid holds, so the grid has to be rebuilt and the
  scroll position no longer means anything.
- Nothing that edits or deletes belongs on a step-one row — that is the row people tap
  every day. Those live on the manage pane.
- There is no first-run mode any more. No stored selection means Home offers Get started
  and step one's Next stays disabled until something is ticked; unticking the last set is
  allowed, because that is where everyone starts.
- Sets the user makes live in `localStorage` and are merged with the generated `SETS` at
  runtime, so anything reading the set list must be a function, not a module-level constant
  — they load after this file does. Membership goes through the one index in `main.js`;
  `card.sets` alone cannot see them.
- There is no default selection. A stored selection that no longer resolves sends someone
  back to step one rather than falling back to a guess.
- Direction and round size are set on the settings pane before the first card and hold for
  the session. Nothing about how a round works may be changeable during it — direction used
  to be, and flipping it rebuilt the multiple-choice options under the live question.
- A session is one pass through the selection, SHUFFLED ONCE and dealt in rounds, so a few
  short rounds cover it exactly once. That is the difference from the cap that was tried and
  removed, which re-sampled at random and guaranteed nothing. Above `ASK_ABOVE` cards the
  settings pane asks all-at-once-or-in-rounds before the first card.
- Mode, direction and pace ARE remembered, in `kanji-practice:prefs`, and Home offers to
  repeat the last session in one tap. This reverses an earlier rule that said pace belongs
  to the sitting and must be asked every time: correct in principle, and wrong for a child
  opening this on the fourth school night in a row. Written in `beginSession`, when a
  session actually starts — not when a radio is tapped, because this describes what someone
  practiced rather than what they were considering on the way there.
- A session in progress is persisted to `kanji-practice:session` so being interrupted does
  not cost the round. `persistSession()` runs at the END of `render()` — a pure function of
  state, so the next person to add a way of changing the round cannot forget to call it —
  and only when the screen is `practice` or `results`, which is what preserves a checkpoint
  someone walked away from. It removes the blob when the last round is finished; retrying
  the misses afterwards is extra work, not an unfinished session.
- `round` is authoritative and `session` is bookkeeping. NOTHING may rebuild `round` from
  `order.slice(dealt - size, dealt)` — that invariant is why a retry round, which is a slice
  of nothing, resumes for free.
- Resuming assigns `state.round` DIRECTLY. Never through `startRound()`, which reshuffles
  and resets the index, so the stored position would land in a different order and replay
  answered cards. `dealRound()` is never replayed either: it advances `dealt` at deal time,
  before the round is played.
- The stored session is written forms, never card objects, and one unresolvable form drops
  the whole blob — a half-restored session practices fewer cards than its plan says and
  corrupts the arithmetic on the way. Same rule as a truncated share link.
- Boot only populates the OFFER (`state.resume`); it never sets `state.screen`. Doing so
  would fight the shared-link branch and drop someone into a round they did not open the
  app for.
- Every count — tally, progress, score ring — follows `state.round`, since a retry and
  "practice the N you missed" both play a subset. `state.session.firstTry` is written once
  per card and never overwritten, so a retry cannot turn a miss into a win.
- An element toggled by the `hidden` attribute must not be given a `display` rule without
  a matching `[hidden] { display: none }`; `display: flex` beats the user-agent rule. Same
  trap as `.is-hidden` below.
- `.is-hidden` is a global `visibility: hidden`. Do not reuse that name for a local
  modifier — Trace mode's masked characters are `.is-masked` because of exactly that.
