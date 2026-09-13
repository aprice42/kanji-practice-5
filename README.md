# Kanji Practice

Flashcard PWA for the 51-item review kanji list in `content/content.md`.

The app opens on a home screen where you pick a mode. Both modes share the same deck,
scoring, progress bar and results screen, and both support the direction switch:

- **かな → 漢字** — see the reading, recall the written form (default)
- **漢字 → かな** — see the written form, recall the reading

### Flash cards

Prompt → tap **Show answer** → the other side plus the meaning → tap ✓ or ✕, which scores
the card and advances. Self-marked.

### Multiple choice

Prompt plus three options — the right answer and two distractors drawn from other cards.
Tapping an option marks it right or wrong and reveals the meaning, then a verdict appears
("Correct" or "Not quite — it's 魚") with a **Continue** button. Nothing advances until
that button is tapped, so there is no time pressure on reading the answer.

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

### Results

A score, a table of the missed cards and a table of the correct ones (reading + written
form), and two buttons: **Practice the N missed** — another round with just those — and
**Start over**. Getting a card right on a retry flips it from missed to correct, so the
score climbs toward 51/51. Clear the whole set and you get confetti (skipped for
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

## Editing the cards

Edit the table in `content/content.md`, then regenerate `src/cards.js` — the format is
one `{ reading, written, meaning }` object per row.
