# Kanji Practice

Flashcard PWA for the 51-item review kanji list in `content/content.md`.

Shows the reading (かな) → tap **Show answer** → written form + meaning → tap ✅ or 🚫,
which scores the card and advances straight to the next one. Tallies run along the top.

At the end you get a score, a table of the missed cards and a table of the correct ones
(reading + written form), and two buttons: **Practice the N missed** — which runs another
round with just those — and **Start over**, which reshuffles all 51 and clears the score.
Retry rounds keep going until nothing is missed; getting a card right on a retry flips it
from missed to correct, so the score climbs toward 51/51.

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
