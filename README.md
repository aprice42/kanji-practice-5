# Kanji Practice

Flashcard PWA for the 51-item review kanji list in `content/content.md`.

Shows the reading (かな) → tap **Show answer** → written form + meaning → tap ✅ or 🚫,
which scores the card and advances straight to the next one. Tallies run along the top. After all 51 cards you get a score and a 🔄 restart
button (the only place restart appears). Restart reshuffles the deck.

## Local

```
npm install
npm run dev
```

## Deploy to Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`

Installable as a PWA (Add to Home Screen) and works offline once loaded.

## Editing the cards

Edit the table in `content/content.md`, then regenerate `src/cards.js` — the format is
one `{ reading, written, meaning }` object per row.
