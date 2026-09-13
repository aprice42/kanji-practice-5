# Klee One

教科書体 (textbook style) Japanese typeface by Fontworks Inc.
Source: https://github.com/fontworks-fonts/Klee — licensed under the SIL Open Font
License 1.1 (see OFL.txt), which permits bundling and redistribution.

`klee-one-400.woff2` and `klee-one-600.woff2` are subsets containing only the
characters these flashcards use, plus basic Latin — about 50 KB each instead of
several megabytes for the full CJK font. If you add cards with new kanji, the
subset must be regenerated or those characters will fall back to a system font.

Regenerate with the Google Fonts API, passing the characters in `text=`:

    https://fonts.googleapis.com/css2?family=Klee+One:wght@400;600&text=<chars>

Request it with a modern browser User-Agent to get woff2 back, then download the
URLs from the returned @font-face rules.
