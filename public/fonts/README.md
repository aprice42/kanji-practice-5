# Klee One

教科書体 (textbook style) Japanese typeface by Fontworks Inc.
Source: https://github.com/fontworks-fonts/Klee — licensed under the SIL Open Font
License 1.1 (see OFL.txt), which permits bundling and redistribution.

`klee-one-400.woff2` and `klee-one-600.woff2` are subsets containing only the
characters these flashcards use, plus basic Latin — about 47 KB each instead of
several megabytes for the full CJK font.

**If you add cards with new kanji, regenerate the subset**, or those characters
fall back to a system font — and on some devices that fallback is a Chinese face
that draws characters like 言 with the wrong shape:

    npm run fonts     # reads src/cards.js, rewrites both .woff2 files
    npm run build     # so the service worker precaches them

That script (`scripts/build-font-subset.mjs`) asks the Google Fonts API for a
subset via its `text=` parameter and saves the result here. It needs network
access. Do not edit these files by hand.
