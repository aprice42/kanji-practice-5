# Kanji Practice

A flashcard PWA for a 5th-grader's kanji homework, built from worksheets his teacher sends
home. Read `README.md` before changing anything — particularly **Decisions already
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
    npm run cards    # content/worksheets/ + content/words/ → src/cards.js
    npm run scaffold # master kanji list → content/words/*.md
    npm run fonts    # rebuild the Klee One subset (needs network)
    npm run strokes  # rebuild the KanjiVG stroke subset (needs network)
    npm run check    # generated files still match the deck — run after adding cards
    npm run audit    # how guessable the multiple-choice questions are
    npm run build    # production build into dist/

## House rules

- `content/worksheets/*.md` and `content/words/*.md` are the source of truth. `src/cards.js`
  (both `cards` and the `DECKS` manifest), `src/strokes.js` and `public/fonts/` are all
  generated from them, and `npm run check` is what proves they still agree — the generators
  only validate their own output, not each other's. `src/strokes.js` comes from KanjiVG,
  CC BY-SA — attribution is required, and lives at the foot of the Trace screen.
- A reading must be unique within a deck, not across them: a word is re-taught as more of
  its kanji arrive. Deck ids (`g4:2`, `w:2025-09-review`) are content-derived and safe to
  persist; a card's `id` is its array index and is not.
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
- `.is-hidden` is a global `visibility: hidden`. Do not reuse that name for a local
  modifier — Trace mode's masked characters are `.is-masked` because of exactly that.
