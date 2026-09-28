# Worksheets

A worksheet his teacher sends home, transcribed. One file per worksheet; each becomes a set in the picker under **Worksheets**, and defines cards of its own.

**This directory is empty on purpose.** Out of the box the app ships the school's Grade 1–5 curriculum and the kana, and nothing that belongs to one particular child. Drop a transcribed worksheet in here and it appears — that is the whole mechanism.

Follow **Adding cards from a new worksheet** in the root `README.md`. In particular: transcribe the scan exactly as printed, including the places where it writes part of a word in kana because that kanji has not been taught yet (でん車, not 電車), then run `npm run fonts`, `npm run strokes` and `npm run check`.
