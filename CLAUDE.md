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
2. **Run `npm run fonts` afterwards.** The bundled font is subset to the characters the
   cards use. New kanji missing from it fall back to a system font, which on some devices
   renders Chinese glyph shapes.

## Deploying

Pushing to `main` deploys it — Cloudflare Workers Builds watches the repo. It is a Worker
serving static assets, configured in `wrangler.jsonc`, not Cloudflare Pages.

## Commands

    npm run dev      # local dev server
    npm run cards    # content/content.md → src/cards.js
    npm run fonts    # rebuild the Klee One subset (needs network)
    npm run audit    # how guessable the multiple-choice questions are
    npm run build    # production build into dist/

## House rules

- `content/content.md` is the source of truth; `src/cards.js` is generated.
- Every Japanese string needs `lang="ja"` — that is what applies the Japanese typeface.
- Colours come from CSS tokens only. Four palettes × light and dark; a literal hex breaks
  seven of the eight combinations.
- The app is sized to fit a phone without scrolling. If you add a row to a screen, re-check
  at ~412×730 and shorter.
- Correct/wrong must differ by shape, not only colour, and every icon needs a text label.
