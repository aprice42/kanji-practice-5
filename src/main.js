import { cards as rawCards, SETS } from './cards.js'
import { shuffle, facesOf, buildChoices } from './choices.js'
import { confetti } from './confetti.js'
import { mountTrace } from './trace.js'
import { isUpdateReady, onUpdateReady, checkForUpdate, applyUpdate } from './update.js'
import { shareUrl, decodeSet, takeSharedFromUrl, ShareError } from './share.js'
import './style.css'

/* A card's id is its written form, not its position in the array.

   The written form is this project's identity key everywhere else — it is what
   `npm run scaffold` merges on, and what survives a new edition of the school's
   list renumbering every row. An array index survives none of that: insert one
   row and every id below it means a different word.

   It also fixes two things the index was quietly getting wrong today. The same
   word can exist as two card objects — 47 do, once under a grade and once under
   the September worksheet — and with index ids those two held separate scores
   for one word, and neither excluded the other from being its own distractor.
   Both of those now resolve to the same card because they are the same word. */
const cards = rawCards.map((card) => ({ ...card, id: card.written }))

const app = document.getElementById('app')

/* Kana cards read in romaji — "shi", not しゃ — and romaji is Latin. Tagging it
   `lang="ja"` would set it in Klee One and tell a screen reader to read English
   letters as Japanese. So a face declares the language of its own content
   rather than inheriting one from the app being about Japanese. */
const ja = (text) => (/[^\x00-\x7F]/.test(String(text)) ? ' lang="ja"' : '')

const CHOICE_COUNT = 3

/* Below this many cards a multiple-choice question cannot be disguised — there
   are not enough same-shaped words to hide the answer among — so distractors
   are drawn from the card's whole grade instead of the selection. */
const MIN_POOL = 8

/* There is no default selection. The app used to open on the September
   worksheet, which is the right answer for exactly one child and the wrong one
   for everyone else in the program. A student who has never chosen is asked
   before anything else; after that the app remembers. */

/* Sets ---------------------------------------------------------------------
   A set is a named selection of cards — a whole grade, a worksheet, or later
   something hand-built. SETS is generated alongside the cards with its labels
   and counts already resolved, so nothing here derives a label by splitting an
   id, and the app never evaluates what "grade 4" means.
   --------------------------------------------------------------------------- */

/* One membership index, and the only place a card's set membership is decided.

   Generated sets are inverted out of `card.sets`. Sets made at runtime cannot
   appear there — `src/cards.js` is a build artifact — so they carry their own
   list of written forms and are folded in here. Everything downstream then asks
   one question and never has to know where a set came from.

   Doing this in one place is load-bearing rather than tidy. `activeCards()`
   used to read `card.sets` directly, so a runtime set merged into the manifest
   would have appeared in the picker, ticked, counted toward the summary row —
   and produced a round of zero cards, silently. */
const membership = new Map()

const cardByForm = new Map(cards.map((card) => [card.written, card]))

function rebuildMembership() {
  membership.clear()
  for (const card of cards) {
    for (const id of card.sets) {
      if (!membership.has(id)) membership.set(id, new Set())
      membership.get(id).add(card.written)
    }
  }
  for (const set of state.userSets) membership.set(set.id, new Set(set.forms))
}

const formsIn = (id) => membership.get(id) ?? new Set()

/* Every set the app knows about: the ones generated into src/cards.js, plus any
   the user has made, which arrive from storage after this file has loaded.

   These are functions rather than constants for exactly that reason. As
   constants they were computed at module load, before storage had been read, so
   a set made at runtime would have been invisible to the picker and — worse —
   dropped by the stored-selection validator as an id it had never heard of. */
const allSets = () => [...SETS, ...state.userSets]

/* A set with nothing filled in yet is listed but cannot be chosen. Showing it
   as `0` would look like a bug, and leaving it out would hide that it exists. */
const isPlayable = (set) => set.cards > 0
const playableSets = () => allSets().filter(isPlayable)

/* Sections, in the order the picker shows them. The order is written out rather
   than derived: sorting only "Curriculum first" would leave every other section
   in whatever order it happened to be encountered, so the first set a user ever
   made would decide where My sets sat forever. A section with nothing in it
   does not appear. */
const SECTION_ORDER = ['Curriculum', 'Worksheets', 'Kana', 'Practice sets', 'My sets']
const sections = () => {
  const present = new Set(allSets().map((s) => s.section))
  const known = SECTION_ORDER.filter((name) => present.has(name))
  const rest = [...present].filter((name) => !SECTION_ORDER.includes(name))
  return [...known, ...rest]
}
const setsIn = (section) => allSets().filter((s) => s.section === section)

/* Display order: by section, then as the manifest lists them. Used by both the
   picker and the summary row, so "Grade 4 & September review" cannot come out
   in one order on the home screen and the other in the panel. */
const displayOrder = () => sections().flatMap(setsIn)

/* Set labels are typed by people. Nothing in this file escaped anything before
   there were sets the app did not generate itself; every label was a string we
   had written. The moment a name can be typed — and, next, arrive in a link
   from a stranger — the three places a label reaches innerHTML need this. */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ESCAPES[c])

/* What the results screen says, and how much confetti it throws.
   Thresholds: 0 / 25 / 50 / 75 / 95 / 100 percent. 76–94 keeps the same words
   as 51–75 but earns a bigger burst, so every threshold crossing is felt. A
   clean miss gets level 0 — no confetti, since there is nothing to celebrate
   yet — and encouragement to try again. How many were missed is already clear
   from the tally and the Missed table, so this line is purely encouragement. */
function celebrationFor(correct, total) {
  const percent = total ? (correct / total) * 100 : 0
  if (percent >= 100) return { message: 'やった!', level: 6 }
  if (percent >= 95) return { message: 'やった!', level: 5 }
  if (percent > 75) return { message: 'もう少し!', level: 4 }
  if (percent > 50) return { message: 'もう少し!', level: 3 }
  if (percent > 25) return { message: 'がんばって!', level: 2 }
  if (percent > 0) return { message: 'がんばって!', level: 1 }
  return { message: 'もっと練習しよう!', level: 0 }
}

const MODES = {
  flashcards: { label: 'Flash cards', icon: 'cards', hint: 'Show the answer, then mark yourself' },
  choice: { label: 'Multiple choice', icon: 'choice', hint: 'Pick the right answer from three' },
  trace: { label: 'Trace', icon: 'brush', hint: 'Draw the written form, stroke by stroke' },
}

/* Icons -------------------------------------------------------------------
   Inline SVG on a 48x48 grid, stroked with currentColor so every mark takes
   the active palette. Correct and wrong differ in shape as well as color.
   ------------------------------------------------------------------------- */

const ICONS = {
  check:
    '<path d="M11 25l9 9 17-20" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>',
  cross:
    '<path d="M14 14L34 34M34 14L14 34" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>',
  spark:
    '<path d="M24 6l3.6 11.4L39 21l-11.4 3.6L24 36l-3.6-11.4L9 21l11.4-3.6Z" fill="currentColor"/>' +
    '<path d="M38 30l1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6 5-1.6Z" fill="currentColor" opacity=".65"/>',
  cards:
    '<rect x="9" y="14" width="21" height="26" rx="3" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M18 10h15a3 3 0 0 1 3 3v22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  choice:
    '<circle cx="13" cy="15" r="4.5" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<circle cx="13" cy="33" r="4.5" fill="currentColor"/>' +
    '<path d="M24 15h15M24 33h15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  brush:
    '<path d="M12 36c0-4 2-6 5-6s5 2 5 5-2 5-5 5c-4 0-6-2-9-2 2-1 4-1 4-2Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M21 31 38 10a3.5 3.5 0 0 1 5 5L22 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  /* The two selection states differ in SHAPE, not only in colour. A state
     carried by a tint alone is invisible to anyone who cannot separate the two
     colours. (There was a third, a bar for "some of this grade", until grades
     stopped being containers of groups.) */
  box:
    '<rect x="10" y="10" width="28" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>',
  boxCheck:
    '<rect x="10" y="10" width="28" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M17 24l5 5 9-11" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  plus:
    '<path d="M24 12v24M12 24h24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  share:
    '<path d="M24 32V8M24 8l-8 8M24 8l8 8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M12 28v10a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V28" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
  trash:
    '<path d="M12 14h24M19 14v-3h10v3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M15 14l2 24h14l2-24" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  pencil:
    '<path d="M10 38h5l20-20a3.5 3.5 0 0 0-5-5L10 33Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M29 14l5 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
  chevron:
    '<path d="M18 14l10 10-10 10" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  menu:
    '<path d="M9 15h30M9 24h30M9 33h30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  home:
    '<path d="M7 23 24 8l17 15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M12 20v18a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2V20" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M20 40V28h8v12" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>',
  /* A 320-degree arc with the arrowhead on its leading end, chasing the gap at
     the top — generated so the head sits tangent to the arc rather than
     approximately near it. */
  restart:
    '<path d="M29.1,9.9A15,15 0 1 1 18.9,9.9" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M15.2,17.1L20.8,9.2L11.4,6.8" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  /* An 8-tooth gear, generated rather than eyeballed so the teeth sit at even
     angles. Paired with the hamburger in the top bar, so it has to read as a
     different shape at 24px — a sliders glyph would have been three horizontal
     lines sitting next to three horizontal lines. */
  gear:
    '<path d="M20.6,9.9L20.9,4.7L27.1,4.7L27.4,9.9L31.6,11.6L35.5,8.2L39.8,12.5L36.4,16.4L38.1,20.6L43.3,20.9L43.3,27.1L38.1,27.4L36.4,31.6L39.8,35.5L35.5,39.8L31.6,36.4L27.4,38.1L27.1,43.3L20.9,43.3L20.6,38.1L16.4,36.4L12.5,39.8L8.2,35.5L11.6,31.6L9.9,27.4L4.7,27.1L4.7,20.9L9.9,20.6L11.6,16.4L8.2,12.5L12.5,8.2L16.4,11.6Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<circle cx="24" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="3"/>',
}

function icon(name, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`
}

const PALETTES = [
  { id: 'indigo', label: 'Indigo', hint: 'Indigo & persimmon — washi paper' },
  { id: 'ink', label: 'Ink', hint: 'Ink & seal — a marked-up page' },
  { id: 'matcha', label: 'Matcha', hint: 'The original teal, harmonised' },
  { id: 'plum', label: 'Plum', hint: 'Plum & citrus' },
]

const THEMES = [
  { id: 'system', label: 'Auto', hint: 'Follow the device setting' },
  { id: 'light', label: 'Light', hint: 'Always light' },
  { id: 'dark', label: 'Dark', hint: 'Always dark' },
]

/* The two directions are always prompt-with-the-reading and
   prompt-with-the-written-form. What those ARE depends on the cards: for a word
   it is kana and kanji; for a kana card it is a romaji sound and the character.
   「かな → 漢字」 on a hiragana set names neither side correctly, so the label
   comes from the selection. The Japanese half is tagged and the English half is
   not, rather than tagging the whole button. */
const DIRECTIONS = [
  {
    id: 'reading-first',
    word: '<span lang="ja">かな → 漢字</span>',
    kana: 'sound → <span lang="ja">かな</span>',
    hint: 'See the reading, recall the written form',
  },
  {
    id: 'written-first',
    word: '<span lang="ja">漢字 → かな</span>',
    kana: '<span lang="ja">かな</span> → sound',
    hint: 'See the written form, recall the reading',
  },
]

const KANA_SECTION = 'Kana'

const state = {
  screen: 'home', // 'home' | 'practice' | 'results' | 'builder' | 'share' | 'receive'
  mode: 'flashcards', // 'flashcards' | 'choice'
  direction: 'reading-first',
  // id -> 'correct' | 'incorrect'. The source of truth for the score: a card
  // answered wrong in round 1 and right in round 2 simply flips to 'correct'.
  status: new Map(),
  // The cards of the round being played, shuffled. Named `round` and not
  // `deck` because a deck is no longer a thing in this app — a selection of
  // sets is.
  round: [],
  index: 0,
  revealed: false,
  choices: [], // multiple-choice options for the current card
  picked: null, // the option the user tapped, until they continue
  theme: 'system', // 'system' | 'light' | 'dark'
  palette: 'indigo',
  /* Set ids, persisted. Ids are content-derived (`g4`, `w:2025-09-review`) and
     survive a row being inserted; a card's id is its written form, and neither
     is ever an array position. */
  selection: new Set(),
  // Sets the user has made. Loaded from storage before loadPrefs, so the
  // stored-selection validator can see them.
  userSets: [],
  /* The set being built or edited, while the builder screen is up. Never
     persisted — nothing is written until Save. */
  builder: null,
  /* The set being shared, while the share screen is up. */
  share: null,
  /* A set arriving from a link. Nothing is written until it is accepted. */
  incoming: null,
  // Ephemeral, never persisted: true while the picker is open.
  sheet: false,
  // Which half of the picker is showing: choosing, or managing.
  sheetTab: 'practice',
  // Which set, if any, is showing its inline "really?" in the library.
  confirmDelete: null,
  /* True until a selection has been chosen for the first time. The picker then
     opens by itself, cannot be dismissed, and will not let go until something
     is picked — there is nothing behind it to do. */
  firstRun: false,
}

/* Theme ------------------------------------------------------------------ */

const THEME_KEY = 'kanji-practice:theme'
const PALETTE_KEY = 'kanji-practice:palette'
const SELECTION_KEY = 'kanji-practice:selection'
const USER_SETS_KEY = 'kanji-practice:sets'

/* Caps. Not storage pressure — 200 written forms is about 2 KB — but because
   the app pages nothing anywhere, and a 500-word round is not a round. */
const MAX_SETS = 30
const MAX_FORMS = 200
const MAX_NAME = 40

function applyTheme() {
  const root = document.documentElement
  if (state.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', state.theme)
  root.setAttribute('data-palette', state.palette)

  // Keep the browser/PWA chrome in step with the chosen theme.
  const dark =
    state.theme === 'dark' ||
    (state.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    // Read it back from the palette rather than hardcoding, so the browser
    // chrome matches whichever scheme is active.
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    if (bg) meta.setAttribute('content', bg)
  }
  return dark
}

function loadPrefs() {
  try {
    const savedTheme = localStorage.getItem(THEME_KEY)
    if (THEMES.some((t) => t.id === savedTheme)) state.theme = savedTheme
    const savedPalette = localStorage.getItem(PALETTE_KEY)
    if (PALETTES.some((p) => p.id === savedPalette)) state.palette = savedPalette

    /* Validated against the manifest, not trusted. A set can disappear when the
       master list is re-ingested or a worksheet is renamed, and a stored id
       that no longer resolves would leave a round with no cards in it. Unknown
       ids are dropped; if nothing survives, the default comes back. */
    const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null')
    if (Array.isArray(saved)) {
      const known = saved.map(migrateSetId).filter((id) => playableSets().some((s) => s.id === id))
      if (known.length) state.selection = new Set(known)
    }
  } catch {
    // Private browsing or blocked storage — stay on the defaults.
  }
  applyTheme()

  /* Nothing stored, or nothing in it still resolves: this person has never
     chosen. Ask, rather than guessing on their behalf. */
  if (!state.selection.size) {
    state.firstRun = true
    state.sheet = true
  }
}

/* Grades used to be four decks each — `g4:1` … `g4:4` — and are now one set.
   A stored id from that era is mapped to its grade rather than dropped: the
   validation above would discard it safely, but the selection would then fall
   back to the September worksheet without a word, which reads as the app
   forgetting what he chose. A quarter of a grade becomes the whole grade, the
   nearest honest equivalent. */
const migrateSetId = (id) => (/^(g[1-5]|ch):\d+$/.test(id) ? id.split(':')[0] : id)

/* Sets the user made, read back from storage.

   Validated rather than trusted, the same way the stored selection is. The
   shape is user-reachable today and will be reachable from a link tomorrow, so
   anything malformed is dropped rather than parsed hopefully. A form that no
   longer resolves to a card is dropped too — the generated cards change under
   a stored set whenever a worksheet is re-ingested — and a set left with
   nothing is dropped with it. */
function normaliseUserSet(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !/^u:[a-z0-9]+$/.test(raw.id)) return null
  if (typeof raw.label !== 'string') return null
  const label = raw.label.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  if (!label) return null
  if (!Array.isArray(raw.forms)) return null
  const forms = [...new Set(raw.forms.filter((f) => typeof f === 'string' && cardByForm.has(f)))]
  if (!forms.length) return null
  return {
    id: raw.id,
    label,
    forms: forms.slice(0, MAX_FORMS),
    section: 'My sets',
    /* `kind` is what a row branches on to decide it is editable. A third value
       rather than reusing 'list', so nothing has to split an id to find out. */
    kind: 'custom',
    created: Number.isFinite(raw.created) ? raw.created : Date.now(),
    /* The RESOLVED count, not forms.length. A set whose words have left the
       master list would otherwise show a number the round cannot deliver, and
       "Done · N cards" would disagree with the round it starts. */
    cards: forms.length,
  }
}

function loadUserSets() {
  try {
    const saved = JSON.parse(localStorage.getItem(USER_SETS_KEY) ?? 'null')
    if (!Array.isArray(saved)) return
    state.userSets = saved.map(normaliseUserSet).filter(Boolean).slice(0, MAX_SETS)
  } catch {
    // Private browsing, blocked storage, or something that is not JSON.
    state.userSets = []
  }
}

/* Unlike a theme preference, a set someone just spent five minutes building
   must not fail to save in silence. Returns the error so the caller can say so. */
function saveUserSets() {
  try {
    localStorage.setItem(USER_SETS_KEY, JSON.stringify(state.userSets))
    return null
  } catch (error) {
    return error
  }
}

function saveSelection() {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...state.selection]))
  } catch {
    // Not persisting is survivable; the choice still applies for this session.
  }
}

/* Selection --------------------------------------------------------------- */

/* The union of the selected sets. Built from the membership index, so a set
   made at runtime resolves the same way a generated one does. */
function activeCards() {
  const wanted = new Set()
  for (const id of state.selection) for (const form of formsIn(id)) wanted.add(form)
  return cards.filter((card) => wanted.has(card.written))
}

const selectedSets = () =>
  displayOrder().filter((s) => isPlayable(s) && state.selection.has(s.id))

/* The last selected set cannot be turned off. An empty selection would mean a
   round with no cards, so rather than disabling every mode and explaining why,
   the state is simply made unreachable. Returns false when it refused, which is
   what the picker announces. */
function setSelected(id, on) {
  if (on) {
    state.selection.add(id)
  } else {
    /* Empty is normally unreachable, because a round with no cards is not a
       state worth designing. During the first run it is where everyone starts,
       and Start stays disabled instead — refusing to untick something a moment
       after ticking it would be nonsense. */
    if (!state.firstRun && state.selection.size <= 1) return false
    state.selection.delete(id)
  }
  saveSelection()
  return true
}

/* What the home screen's summary row says. Names what was chosen for as long as
   naming it stays shorter than counting it. */
function describeSelection() {
  const chosen = selectedSets()
  if (!chosen.length) return 'Nothing selected'
  if (chosen.length === 1) return chosen[0].label
  if (chosen.length === 2) return `${chosen[0].label} & ${chosen[1].label}`
  return `${chosen.length} sets`
}

function setPalette(palette) {
  state.palette = palette
  applyTheme()
  try {
    localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // Not persisting is survivable; the choice still applies for this session.
  }
  for (const btn of document.querySelectorAll('.palette__btn')) {
    const on = btn.dataset.palette === palette
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-pressed', String(on))
  }
}

function paletteSwitch() {
  return `
    <div class="palette" role="group" aria-label="Color scheme">
      ${PALETTES.map(
        (p) => `<button class="palette__btn ${state.palette === p.id ? 'is-active' : ''}"
                    data-palette="${p.id}" aria-pressed="${state.palette === p.id}"
                    title="${p.hint}">
                  <span class="palette__swatch" data-swatch="${p.id}" aria-hidden="true"></span>
                  ${p.label}
                </button>`
      ).join('')}
    </div>`
}

function bindPaletteSwitch() {
  for (const btn of document.querySelectorAll('.palette__btn')) {
    btn.addEventListener('click', () => setPalette(btn.dataset.palette))
  }
}

function setTheme(theme) {
  state.theme = theme
  applyTheme()
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Not persisting is survivable; the choice still applies for this session.
  }
  // Update every theme control in place so an open menu stays open.
  for (const btn of document.querySelectorAll('.theme__btn')) {
    const on = btn.dataset.theme === theme
    btn.classList.toggle('is-active', on)
    btn.setAttribute('aria-pressed', String(on))
  }
}

function themeSwitch() {
  return `
    <div class="theme" role="group" aria-label="Color theme">
      ${THEMES.map(
        (t) => `<button class="theme__btn ${state.theme === t.id ? 'is-active' : ''}"
                    data-theme="${t.id}" aria-pressed="${state.theme === t.id}"
                    title="${t.hint}">${t.label}</button>`
      ).join('')}
    </div>`
}

function bindThemeSwitch() {
  for (const btn of document.querySelectorAll('.theme__btn')) {
    btn.addEventListener('click', () => setTheme(btn.dataset.theme))
  }
}

/* State helpers ---------------------------------------------------------- */

const faces = (card) => facesOf(card, state.direction)
const answerFace = (card) => faces(card).answer

/* Scoped to the round, not to every card that exists. A round is the whole
   selection, but "Practice the N you missed" plays a subset — and scanning all
   743 would have that round report "7 of 743". */
function byStatus(kind) {
  return state.round.filter((card) => state.status.get(card.id) === kind)
}

/* Where a multiple-choice question's wrong answers come from.

   Normally the selection, because a distractor is only convincing if it is
   something the child is actually studying. But a question needs same-shaped
   words to hide the answer among, and a small set cannot supply them — at that
   size the correct option is often the only one whose okurigana fits the
   prompt, which is answerable without reading any kanji at all. So a small
   selection widens to the card's whole grade. `npm run audit` measures exactly
   this, per set.

   The grade comes off the card now rather than through a manifest lookup, which
   fixes worksheet cards: they used to resolve to a deck with no grade and
   silently lose the widening. A teacher-composed form still has no grade to
   widen to, and still does not widen — honestly, this time. */
function distractorPool(card) {
  const active = activeCards()
  if (active.length >= MIN_POOL) return active
  if (card.grade == null) return active
  const wider = cards.filter((c) => c.grade === card.grade)
  return wider.length > active.length ? wider : active
}

function prepareCard() {
  state.revealed = false
  state.picked = null
  const card = state.round[state.index]
  state.choices =
    state.mode === 'choice'
      ? buildChoices(distractorPool(card), card, state.direction, CHOICE_COUNT)
      : []
}

/* A round is the whole selection. A cap was tried and removed: it drew a fresh
   random sample every round, so nothing guaranteed he ever saw every card, and
   the September review — 51 cards, his actual homework — could no longer be
   worked start to finish. Length is controlled by what is selected instead,
   which is what Groups are for. Making a 232-card grade digestible is a real
   problem and still an open one; a random sample was not the answer to it. */
function startRound(list) {
  state.round = shuffle(list)
  state.index = 0
  state.screen = 'practice'
  prepareCard()
  render()
}

function restart() {
  state.status.clear()
  startRound(activeCards())
}

function practiceMissed() {
  startRound(byStatus('incorrect'))
}

function goHome() {
  state.screen = 'home'
  render()
}

function setMode(mode) {
  // Unreachable through the UI — the picker is in the way until something is
  // chosen — but a round of nothing is not a state to leave possible.
  if (!state.selection.size) return
  if (state.mode === mode && state.screen === 'practice') return
  state.mode = mode
  restart()
}

function score(kind) {
  state.status.set(state.round[state.index].id, kind)
  if (state.index + 1 >= state.round.length) {
    state.screen = 'results'
    render()
    return
  }
  state.index++
  prepareCard()
  render()
}

/* Shared chrome ---------------------------------------------------------- */

function tally() {
  const correct = byStatus('correct').length
  const incorrect = byStatus('incorrect').length
  return `
    <div class="tally" role="status" aria-live="polite">
      <span class="tally__group">
        ${icon('check', 'icon--tally is-good')}
        <span class="tally__count">${correct}</span>
        <span class="visually-hidden">correct</span>
      </span>
      <span class="tally__group">
        <span class="tally__count">${incorrect}</span>
        ${icon('cross', 'icon--tally is-bad')}
        <span class="visually-hidden">incorrect</span>
      </span>
    </div>`
}

/* Two popovers, not one. The hamburger is navigation — where do I go next —
   and the gear is settings. They were a single panel until it grew to hold
   three modes, two switches, start over, home and a licence credit, at which
   point "☰" stopped describing it. Both are built by the same helper so they
   cannot drift apart in behaviour. */
function popover({ id, label, iconName, align, body }) {
  return `
    <div class="menu${align === 'end' ? ' menu--end' : ''}">
      <button class="menu__trigger" id="${id}-trigger" aria-haspopup="true"
              aria-expanded="false" aria-controls="${id}-panel">
        ${icon(iconName, 'icon--menu')}
        <span class="visually-hidden">${label}</span>
      </button>
      <div class="menu__panel" id="${id}-panel" role="menu" hidden>
        ${body}
      </div>
    </div>`
}

function navMenu() {
  const others = Object.keys(MODES).filter((id) => id !== state.mode)
  return popover({
    id: 'nav',
    label: 'Menu',
    iconName: 'menu',
    align: 'start',
    body: `
      <p class="menu__heading">Exercises</p>
      ${others
        .map(
          (id) => `<button role="menuitem" data-act="mode:${id}">
                     ${icon(MODES[id].icon, 'icon--menu-item')} ${MODES[id].label}
                   </button>`
        )
        .join('')}
      <hr />
      <button role="menuitem" data-act="restart">
        ${icon('restart', 'icon--menu-item')} Start over
      </button>
      <button role="menuitem" data-act="home">
        ${icon('home', 'icon--menu-item')} Home
      </button>`,
  })
}

function settingsMenu() {
  return popover({
    id: 'settings',
    label: 'Settings',
    iconName: 'gear',
    align: 'end',
    body: `
      <p class="menu__heading">Theme</p>
      ${themeSwitch()}
      <p class="menu__heading">Color scheme</p>
      ${paletteSwitch()}`,
  })
}

/* Binds both popovers. Opening one closes the other, and each closes on an
   outside click or Escape. */
function bindMenus() {
  const panels = []

  const closeAll = (except) => {
    for (const { trigger, panel } of panels) {
      if (panel === except || panel.hidden) continue
      panel.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
    }
    if (!panels.some(({ panel }) => !panel.hidden)) {
      document.removeEventListener('click', onOutside, true)
      document.removeEventListener('keydown', onKey)
    }
  }

  function onOutside(event) {
    if (!event.target.closest('.menu')) closeAll()
  }

  function onKey(event) {
    if (event.key !== 'Escape') return
    const open = panels.find(({ panel }) => !panel.hidden)
    closeAll()
    open?.trigger.focus()
  }

  for (const id of ['nav', 'settings']) {
    const trigger = document.getElementById(`${id}-trigger`)
    if (!trigger) continue
    const panel = document.getElementById(`${id}-panel`)
    panels.push({ trigger, panel })

    trigger.addEventListener('click', () => {
      if (panel.hidden) {
        closeAll(panel)
        panel.hidden = false
        trigger.setAttribute('aria-expanded', 'true')
        panel.querySelector('button')?.focus()
        document.addEventListener('click', onOutside, true)
        document.addEventListener('keydown', onKey)
      } else {
        closeAll()
      }
    })
  }

  bindThemeSwitch()
  bindPaletteSwitch()

  for (const item of document.querySelectorAll('.menu__panel [data-act]')) {
    item.addEventListener('click', () => {
      const act = item.dataset.act
      closeAll()
      if (act === 'restart') restart()
      else if (act === 'home') goHome()
      else if (act.startsWith('mode:')) setMode(act.slice(5))
    })
  }
}

/* The selection sheet -----------------------------------------------------
   A dialog rather than a screen: choosing what to practice is a detour from
   starting a round, not a step in it, and a panel keeps the home screen visible
   behind it.
   ------------------------------------------------------------------------- */

const BOX = { true: 'boxCheck', false: 'box' }

function setRow(set) {
  const ready = isPlayable(set)
  const checked = String(state.selection.has(set.id))
  const check = `
    <button class="sheet__check" role="checkbox" aria-checked="${checked}"
            ${ready ? '' : 'disabled'} data-set="${set.id}">
      <span class="sheet__box">${icon(BOX[checked], 'icon--box')}</span>
      <span class="sheet__label">${escapeHtml(set.label)}</span>
      <span class="sheet__count ${ready ? '' : 'is-muted'}">${ready ? set.cards : 'not ready'}</span>
      <span class="visually-hidden">${ready ? `${set.cards} cards` : 'no cards yet'}</span>
    </button>`

  /* Every row is one control, including the user's own. Editing and deleting
     live on the My sets tab instead: they are a different job on a different
     rhythm, and a destructive button beside the checkbox you came to press is
     a mis-tap on a 412px screen. */
  return check
}

/* A set the user made, on the My sets tab. `kind` is what makes it editable,
   not the shape of its id. */
function libraryCard(set) {
  const confirming = state.confirmDelete === set.id
  return `
    <div class="libcard">
      <span class="libcard__name">
        ${escapeHtml(set.label)}
        <small>${set.cards} word${set.cards === 1 ? '' : 's'}</small>
      </span>
      ${
        confirming
          ? `<button class="libcard__confirm" data-reallydelete="${set.id}">Delete</button>
             <button class="libcard__keep" data-keepset="${set.id}">Keep</button>`
          : `<button class="libcard__act" data-share="${set.id}">
               ${icon('share', 'icon--act')}
               <span class="visually-hidden">Share ${escapeHtml(set.label)}</span>
             </button>
             <button class="libcard__act" data-edit="${set.id}">
               ${icon('pencil', 'icon--act')}
               <span class="visually-hidden">Edit ${escapeHtml(set.label)}</span>
             </button>
             <button class="libcard__act libcard__act--danger" data-delete="${set.id}">
               ${icon('trash', 'icon--act')}
               <span class="visually-hidden">Delete ${escapeHtml(set.label)}</span>
             </button>`
      }
    </div>`
}

function renderSheet() {
  if (!state.sheet) return ''
  const first = state.firstRun
  const count = activeCards().length
  /* No tabs during the first run. Someone who has chosen nothing yet has one
     job, and a second tab holding an empty library is a detour away from it. */
  const tab = first ? 'practice' : state.sheetTab
  const mine = state.userSets

  return `
    <div class="sheet-scrim" ${first ? '' : 'data-close'}></div>
    <section class="sheet" role="dialog" aria-modal="true"
             aria-labelledby="sheet-title" ${first ? 'aria-describedby="sheet-lede"' : ''}>
      <h2 class="sheet__title" id="sheet-title">
        ${first ? 'What would you like to practice?' : tab === 'practice' ? 'What to practice' : 'My sets'}
      </h2>
      ${
        first
          ? `<p class="sheet__lede" id="sheet-lede">
               Pick as many as you like. You can change this whenever you want.
             </p>`
          : `<div class="tabs" role="tablist" aria-label="Choosing or managing">
               <button role="tab" id="tab-practice" data-tab="practice"
                       aria-selected="${tab === 'practice'}" aria-controls="sheet-panel">Practice</button>
               <button role="tab" id="tab-mine" data-tab="mine"
                       aria-selected="${tab === 'mine'}" aria-controls="sheet-panel">My sets</button>
             </div>`
      }
      <div class="sheet__list" id="sheet-panel" role="tabpanel"
           aria-labelledby="${first ? 'sheet-title' : `tab-${tab}`}">
        ${
          tab === 'practice'
            ? sections()
                .map(
                  (section) => `
            <p class="menu__heading">${escapeHtml(section)}</p>
            ${setsIn(section).map(setRow).join('')}`
                )
                .join('')
            : `${
                mine.length
                  ? mine.map(libraryCard).join('')
                  : `<p class="sheet__empty">
                       Nothing here yet. A set is any words you want to practise
                       together — the ones on this week's test, or the ones you
                       keep getting wrong.
                     </p>`
              }
               <button class="libnew" id="new-set">
                 ${icon('plus', 'icon--act')}
                 <span><b>New set</b><small>Pick words and give it a name</small></span>
               </button>`
        }
      </div>
      <p class="sheet__note" role="status" aria-live="polite"></p>
      <div class="sheet__foot">
        <button class="btn" data-close ${first && !count ? 'disabled' : ''}>
          ${
            /* The count belongs to the practice selection, so it is only shown
               where you are choosing one. On My sets it would be reporting a
               number you did not just change.

               The button itself stays: Escape and the scrim also close this,
               but neither is discoverable on a phone, and a panel with no
               visible way out is a dead end. */
            first
              ? `Start${count ? ` · ${count} cards` : ''}`
              : tab === 'practice'
                ? `Done · ${count} cards`
                : 'Done'
          }
        </button>
      </div>
    </section>`
}

/* Sharing a set ----------------------------------------------------------
   A link carrying the written forms, and a QR code of that link. The QR is the
   point: a teacher sending a link to thirty students needs thirty addresses,
   and children this age mostly do not have email. A teacher putting a QR code
   on the smartboard needs nothing at all.
   ------------------------------------------------------------------------- */

/* The QR encoder is 50 KB, and it is needed by one screen that most people will
   never open. Loaded on demand so it is its own chunk rather than part of the
   app's first parse — still precached, because a teacher standing in front of a
   class on bad school wifi is exactly who needs it to work offline. */
let qrcode = null
const loadQr = () =>
  qrcode
    ? Promise.resolve(qrcode)
    : import('qrcode-generator').then((m) => (qrcode = m.default))

function openShare(id) {
  const set = state.userSets.find((s) => s.id === id)
  if (!set) return
  state.share = { set, url: '', status: '' }
  state.sheet = false
  state.screen = 'share'
  render()

  // Both are async — compression, and fetching the encoder — so the screen
  // draws first and fills in.
  Promise.all([shareUrl({ label: set.label, forms: set.forms }), loadQr()])
    .then(([url]) => {
      if (state.share?.set.id !== id) return
      state.share.url = url
      render()
    })
    .catch(() => {
      if (state.share?.set.id !== id) return
      state.share.status = 'This set could not be turned into a link.'
      render()
    })
}

function closeShare() {
  state.share = null
  state.screen = 'home'
  state.sheet = true
  state.sheetTab = 'mine'
  render()
}

/* Drawn as an <img> from a data URL rather than a canvas: it prints, it can be
   long-pressed and saved like any other image, and it needs no redraw on
   resize. Always on white — a QR inverted for dark mode does not scan. */
function qrTag(url) {
  try {
    const code = qrcode(0, 'M')
    code.addData(url)
    code.make()
    return `<img class="qr__img" src="${code.createDataURL(4, 8)}"
                 alt="QR code containing the link to this set" />`
  } catch {
    return `<p class="qr__fail">This set is too long to fit in a QR code. The link still works.</p>`
  }
}

function renderShare() {
  const { set, url, status } = state.share
  const canSend = typeof navigator.share === 'function'

  app.innerHTML = `
    <header class="topbar">
      <button class="menu__trigger" id="share-back">
        ${icon('home', 'icon--menu')}
        <span class="visually-hidden">Back to my sets</span>
      </button>
      <h1 class="builder__title">Share this set</h1>
      ${settingsMenu()}
    </header>

    <div class="share">
      <div class="share__head">
        <p class="share__name">${escapeHtml(set.label)}</p>
        <p class="share__count">${set.cards} word${set.cards === 1 ? '' : 's'}</p>
      </div>

      ${
        url
          ? `<div class="qr">${qrTag(url)}</div>
             <p class="share__hint">Point a camera at it, or use the link below.</p>
             <p class="share__link" id="share-link">${escapeHtml(url)}</p>`
          : `<p class="share__hint">${escapeHtml(status || 'Making the link…')}</p>`
      }
    </div>

    <div class="actions share__actions">
      <p class="share__status" role="status" aria-live="polite">${escapeHtml(status && url ? status : '')}</p>
      <button class="btn" id="share-copy" ${url ? '' : 'disabled'}>Copy link</button>
      ${canSend ? `<button class="btn btn--secondary" id="share-send" ${url ? '' : 'disabled'}>Send…</button>` : ''}
    </div>`

  document.getElementById('share-back').addEventListener('click', closeShare)

  /* Updated in place, not re-rendered. The fallback below selects the link so
     it can be copied by hand, and a re-render replaces the DOM and throws that
     selection away — the message would be telling the truth about something
     that had just been undone. */
  document.getElementById('share-copy')?.addEventListener('click', async () => {
    const say = (text) => {
      state.share.status = text
      const node = document.querySelector('.share__status')
      if (node) node.textContent = text
    }
    try {
      await navigator.clipboard.writeText(state.share.url)
      say('Link copied.')
    } catch {
      // Blocked in some embedded browsers. Selecting the text is the honest
      // fallback — saying "copied" when nothing was is worse.
      const el = document.getElementById('share-link')
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        getSelection().removeAllRanges()
        getSelection().addRange(range)
      }
      say('Could not copy it — the link is selected, copy it by hand.')
    }
  })

  document.getElementById('share-send')?.addEventListener('click', () => {
    navigator
      .share({ title: set.label, text: `${set.label} — kanji practice`, url: state.share.url })
      .catch(() => {
        /* Cancelling rejects, and so does a failure. Either way nothing was
           sent, and the screen should not claim otherwise. */
      })
  })

  bindMenus()
}

/* Receiving a set -------------------------------------------------------
   A link from outside the app is untrusted input, so nothing is written until
   the person says yes — and what they are saying yes to is shown in full. The
   words are the thing: "Week 3 test, 30 words" tells you nothing, while seeing
   こん立て tells you whether it is the right list.
   ------------------------------------------------------------------------- */

const sameWords = (a, b) =>
  a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ')

async function receiveShared(payload) {
  try {
    const { label, forms } = await decodeSet(payload)
    const known = forms.filter((form) => cardByForm.has(form))
    const missing = forms.filter((form) => !cardByForm.has(form))

    if (!known.length) {
      state.incoming = { state: 'none', label, missing }
    } else {
      /* Matched on contents rather than name: the same list sent twice, or
         forwarded by a friend, is the same set whatever it got called. */
      const duplicate = state.userSets.find((set) => sameWords(set.forms, known))
      state.incoming = { state: 'ready', label, known, missing, duplicate }
    }
  } catch (error) {
    state.incoming = { state: 'error', reason: error instanceof ShareError ? error.message : 'incomplete' }
  }
  render()
}

const RECEIVE_TROUBLE = {
  incomplete:
    'This link looks incomplete. Messaging apps sometimes cut long links in half — ask for it again, or copy the whole thing.',
  newer:
    'This link was made by a newer version of the app. Update yours and open it again.',
  unsupported:
    'This browser cannot read shared links. Opening it in a different browser should work.',
  empty: 'There was no set in that link.',
}

function renderReceive() {
  const it = state.incoming
  const body = () => {
    if (!it || it.state === 'loading') {
      return `<p class="receive__note">Opening the shared set…</p>`
    }
    if (it.state === 'error') {
      return `<p class="receive__trouble">${escapeHtml(RECEIVE_TROUBLE[it.reason] ?? RECEIVE_TROUBLE.incomplete)}</p>`
    }
    if (it.state === 'none') {
      return `<p class="receive__trouble">
          None of the words in “${escapeHtml(it.label)}” are in your version of the app yet.
          Updating the app may bring them in.
        </p>`
    }
    return `
      <div class="receive__head">
        <p class="receive__from">Someone shared a set with you</p>
        <p class="receive__name">${escapeHtml(it.label)}</p>
        <p class="receive__count">
          ${it.known.length} word${it.known.length === 1 ? '' : 's'}${
            it.missing.length ? ` of ${it.known.length + it.missing.length}` : ''
          }
        </p>
      </div>
      ${
        it.duplicate
          ? `<p class="receive__banner receive__banner--ok">
               You already have these words, saved as “${escapeHtml(it.duplicate.label)}”.
             </p>`
          : ''
      }
      ${
        it.missing.length
          ? `<p class="receive__banner receive__banner--warn">
               ${it.missing.length} word${it.missing.length === 1 ? ' is' : 's are'} not in your
               version of the app yet and will be left out. Updating may bring
               ${it.missing.length === 1 ? 'it' : 'them'} in.
             </p>`
          : ''
      }
      <div class="receive__words">
        ${it.known.map((w) => `<span class="word"${ja(w)}>${escapeHtml(w)}</span>`).join('')}
        ${it.missing
          .map((w) => `<span class="word word--gone"${ja(w)}>${escapeHtml(w)}</span>`)
          .join('')}
      </div>`
  }

  const ready = it && it.state === 'ready'

  app.innerHTML = `
    <header class="topbar">
      <span class="topbar__spacer"></span>
      <span class="topbar__spacer"></span>
      ${settingsMenu()}
    </header>

    <div class="receive">${body()}</div>

    <div class="actions receive__actions">
      <p class="receive__status" role="status" aria-live="polite">${escapeHtml(it?.status ?? '')}</p>
      ${
        ready
          ? it.duplicate
            ? `<button class="btn" id="receive-open">Open the one I have</button>`
            : `<button class="btn" id="receive-save">Save ${
                it.missing.length ? `these ${it.known.length}` : 'it'
              }</button>`
          : ''
      }
      <button class="btn ${ready ? 'btn--secondary' : ''}" id="receive-dismiss">
        ${ready ? 'Not now' : 'Continue to the app'}
      </button>
    </div>`

  document.getElementById('receive-save')?.addEventListener('click', saveIncoming)
  document.getElementById('receive-open')?.addEventListener('click', () => {
    state.selection.add(state.incoming.duplicate.id)
    saveSelection()
    dismissIncoming()
  })
  document.getElementById('receive-dismiss').addEventListener('click', dismissIncoming)
  bindMenus()
}

function saveIncoming() {
  const it = state.incoming
  if (state.userSets.length >= MAX_SETS) {
    it.status = `That is ${MAX_SETS} sets, which is as many as this holds. Delete one and open the link again.`
    render()
    return
  }

  const set = {
    id: newSetId(),
    label: it.label,
    forms: it.known.slice(0, MAX_FORMS),
    section: 'My sets',
    kind: 'custom',
    created: Date.now(),
    cards: Math.min(it.known.length, MAX_FORMS),
  }
  state.userSets.push(set)
  const failed = saveUserSets()
  if (failed) {
    state.userSets.pop()
    it.status = 'There is no room left to save this. Delete a set and open the link again.'
    render()
    return
  }

  rebuildMembership()
  state.selection.add(set.id)
  saveSelection()
  dismissIncoming()
}

/* Declining still has to leave them somewhere sensible. Someone who has never
   chosen anything came here from a link and has chosen nothing — which is
   exactly the state the first-run picker exists for. */
function dismissIncoming() {
  state.incoming = null
  state.screen = 'home'
  if (!state.selection.size) {
    state.firstRun = true
    state.sheet = true
    state.sheetTab = 'practice'
  }
  render()
}

/* The set builder ---------------------------------------------------------

   A screen, not a second dialog. The picker is already `aria-modal`, and a
   modal inside a modal means two focus traps and an ambiguous Escape; the
   builder also wants the whole viewport on a phone. Opening it closes the
   picker, and Save or Cancel brings the picker back with the set in it.
   ------------------------------------------------------------------------- */

const newSetId = () => `u:${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`

/* Filters are the sets the app generated. Filtering by another set you made is
   not useful and would grow the row every time you made one. */
const FILTERS = () => SETS.filter(isPlayable)

function openBuilder(id) {
  const existing = state.userSets.find((s) => s.id === id)
  state.builder = {
    id: existing?.id ?? null,
    label: existing?.label ?? '',
    forms: new Set(existing?.forms ?? []),
    query: '',
    filter: null,
    error: '',
  }
  state.sheet = false
  state.screen = 'builder'
  render()
}

function closeBuilder() {
  state.builder = null
  state.screen = 'home'
  state.sheet = true
  // Back to the tab the builder was opened from, which is always My sets.
  state.sheetTab = 'mine'
  render()
}

/* Written form first, then reading, then meaning — a child copying a list off
   a sheet of paper is matching characters, and a parent looking for "bicycle"
   can wait. Written matches sort ahead of the rest for the same reason. */
function builderMatches() {
  const { query, filter } = state.builder
  const q = query.trim().toLowerCase()
  // Nothing typed and no list chosen: show nothing rather than all 839.
  if (!q && !filter) return null

  const pool = filter ? cards.filter((c) => formsIn(filter).has(c.written)) : cards
  if (!q) return pool

  const byWritten = []
  const byRest = []
  for (const card of pool) {
    if (card.written.includes(query.trim())) byWritten.push(card)
    else if (card.reading.toLowerCase().includes(q)) byRest.push(card)
    else if (card.meaning && card.meaning.toLowerCase().includes(q)) byRest.push(card)
  }
  return [...byWritten, ...byRest]
}

/* Rendering all 839 is about five thousand elements and shapes 839 Japanese
   glyphs at once — a visible stall on a school Chromebook, for a screen that
   shows twelve of them at a time. A query this broad is one the person should
   narrow. */
const SHOW_LIMIT = 60

function builderTile(card) {
  const on = state.builder.forms.has(card.written)
  return `
    <button class="wordtile" type="button" aria-pressed="${on}" data-form="${escapeHtml(card.written)}">
      <span class="wordtile__w"${ja(card.written)}>${escapeHtml(card.written)}</span>
      <span class="wordtile__r"${ja(card.reading)}>${escapeHtml(card.reading)}</span>
    </button>`
}

function renderBuilder() {
  const b = state.builder
  const matches = builderMatches()
  const shown = matches ? matches.slice(0, SHOW_LIMIT) : []
  const chosen = cards.filter((c) => b.forms.has(c.written))
  const full = b.forms.size >= MAX_FORMS
  const canSave = Boolean(b.label.trim()) && b.forms.size > 0

  app.innerHTML = `
    <header class="topbar">
      <button class="menu__trigger" id="builder-back">
        ${icon('home', 'icon--menu')}
        <span class="visually-hidden">Back without saving</span>
      </button>
      <h1 class="builder__title">${b.id ? 'Edit set' : 'New set'}</h1>
      ${settingsMenu()}
    </header>

    <div class="builder">
      <div class="builder__field">
        <label for="set-name">Name</label>
        <input type="text" id="set-name" value="${escapeHtml(b.label)}" maxlength="${MAX_NAME}"
               placeholder="Week 3 test" autocomplete="off" />
      </div>

      <div class="builder__chosen">
        <p class="builder__chosenhead">
          <span>Chosen</span>
          <span class="builder__count">${b.forms.size}${full ? ` · full` : ''}</span>
        </p>
        ${
          chosen.length
            ? `<div class="chips">${chosen
                .map(
                  (c) => `<button class="chip" type="button" data-drop="${escapeHtml(c.written)}">
                            <span${ja(c.written)}>${escapeHtml(c.written)}</span>
                            <span class="chip__x" aria-hidden="true">×</span>
                            <span class="visually-hidden">Remove</span>
                          </button>`
                )
                .join('')}</div>`
            : `<p class="builder__hint">Nothing chosen yet.</p>`
        }
      </div>

      <div class="builder__find">
        <div class="builder__field">
          <label for="set-search">Find words</label>
          <input type="search" id="set-search" value="${escapeHtml(b.query)}"
                 placeholder="A word, a reading, or a meaning" autocomplete="off" />
        </div>
        <div class="pills" role="group" aria-label="Show words from">
          ${FILTERS()
            .map(
              (set) => `<button class="pill" type="button" data-filter="${set.id}"
                          aria-pressed="${b.filter === set.id}">${escapeHtml(set.label)}</button>`
            )
            .join('')}
        </div>
        <div class="builder__results">
          ${
            matches === null
              ? `<p class="builder__hint">Search for a word, or pick a list below to browse it.</p>`
              : shown.length
                ? `<div class="wordgrid">${shown.map(builderTile).join('')}</div>
                   ${
                     matches.length > SHOW_LIMIT
                       ? `<p class="builder__hint">${matches.length} matches. Keep typing to narrow it down.</p>`
                       : ''
                   }`
                : `<p class="builder__hint">Nothing matches.</p>`
          }
        </div>
      </div>
    </div>

    <div class="actions builder__actions">
      <p class="builder__error" role="status" aria-live="polite">${escapeHtml(b.error)}</p>
      <div class="builder__buttons">
        <button class="btn btn--secondary" id="builder-cancel">Cancel</button>
        <button class="btn" id="save-set" ${canSave ? '' : 'disabled'}>Save</button>
      </div>
    </div>`

  bindBuilder()
}

function bindBuilder() {
  const b = state.builder
  const name = document.getElementById('set-name')
  const search = document.getElementById('set-search')

  /* The two text fields update state and refresh only what depends on them, so
     the caret survives. Everything else re-renders. */
  name.addEventListener('input', () => {
    b.label = name.value
    b.error = ''
    const save = document.getElementById('save-set')
    if (save) save.disabled = !(b.label.trim() && b.forms.size)
  })

  search.addEventListener('input', () => {
    b.query = search.value
    const at = search.selectionStart
    render()
    const next = document.getElementById('set-search')
    next.focus()
    next.setSelectionRange(at, at)
  })

  /* A pill is a toggle, not a radio: pressing the active one clears it and
     goes back to searching everything. There is no All pill, because "all" is
     839 tiles nobody wants and search already spans the lot. */
  for (const pill of app.querySelectorAll('[data-filter]')) {
    pill.addEventListener('click', () => {
      b.filter = b.filter === pill.dataset.filter ? null : pill.dataset.filter
      render()
    })
  }

  for (const tile of app.querySelectorAll('[data-form]')) {
    tile.addEventListener('click', () => {
      const form = tile.dataset.form
      if (b.forms.has(form)) b.forms.delete(form)
      else if (b.forms.size >= MAX_FORMS) {
        b.error = `A set holds ${MAX_FORMS} words at most.`
        render()
        return
      } else b.forms.add(form)
      b.error = ''
      render()
    })
  }

  for (const chip of app.querySelectorAll('[data-drop]')) {
    chip.addEventListener('click', () => {
      b.forms.delete(chip.dataset.drop)
      render()
    })
  }

  document.getElementById('builder-back').addEventListener('click', closeBuilder)
  document.getElementById('builder-cancel').addEventListener('click', closeBuilder)
  document.getElementById('save-set')?.addEventListener('click', saveBuilder)

  bindMenus()
}

function saveBuilder() {
  const b = state.builder
  const label = b.label.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  const forms = cards.filter((c) => b.forms.has(c.written)).map((c) => c.written)
  if (!label || !forms.length) return

  const existing = b.id ? state.userSets.find((s) => s.id === b.id) : null
  if (!existing && state.userSets.length >= MAX_SETS) {
    b.error = `That is ${MAX_SETS} sets, which is as many as this holds. Delete one first.`
    render()
    return
  }

  const id = b.id ?? newSetId()
  const set = {
    id,
    label,
    forms,
    section: 'My sets',
    kind: 'custom',
    created: existing?.created ?? Date.now(),
    cards: forms.length,
  }
  if (existing) state.userSets[state.userSets.indexOf(existing)] = set
  else state.userSets.push(set)

  const failed = saveUserSets()
  if (failed) {
    // Five minutes of work must not disappear quietly. Stay put and say so.
    if (existing) state.userSets[state.userSets.indexOf(set)] = existing
    else state.userSets.pop()
    b.error = 'There is no room left to save this. Delete a set and try again.'
    render()
    return
  }

  rebuildMembership()
  state.selection.add(id)
  saveSelection()
  closeBuilder()
}

function deleteSet(id) {
  state.userSets = state.userSets.filter((s) => s.id !== id)
  saveUserSets()
  rebuildMembership()
  state.selection.delete(id)
  saveSelection()

  /* Deleting the only thing selected leaves the state the app reads as "has
     never chosen", which already has an answer: ask again. Picking something on
     their behalf would be the guess this app stopped making. */
  if (!state.selection.size) {
    state.firstRun = true
    state.sheetTab = 'practice'
  }
  state.confirmDelete = null
  render()
}

/* Ticking a box updates the controls in place rather than re-rendering.

   Re-rendering was the obvious thing and it was wrong: render() replaces the
   home screen wholesale, so every tick built a new .sheet, which restarted its
   entry animation and repainted the screen behind it. It read as a flash on
   every click. The theme and palette switches already avoid this for the same
   reason — see setTheme — so this follows them.

   Everything that can disagree is updated here: each box, the Done count, and
   the summary row behind the scrim. */
function syncSheet() {
  for (const btn of app.querySelectorAll('.sheet [data-set]')) {
    const checked = String(state.selection.has(btn.dataset.set))
    btn.setAttribute('aria-checked', checked)
    btn.querySelector('.sheet__box').innerHTML = icon(BOX[checked], 'icon--box')
  }

  const count = activeCards().length
  const done = app.querySelector('.sheet__foot .btn')
  if (done) {
    done.textContent = state.firstRun
      ? `Start${count ? ` · ${count} cards` : ''}`
      : state.sheetTab === 'practice'
        ? `Done · ${count} cards`
        : 'Done'
    done.disabled = state.firstRun && !count
  }

  // The summary row is visible through the scrim, so it must not lag behind.
  const name = app.querySelector('.selection__name')
  if (name) name.textContent = describeSelection()
  const shown = app.querySelector('.selection__count')
  if (shown) shown.textContent = `${count} cards`
}

/* Opening and closing are the only re-renders, so the entry animation runs
   once. Focus goes into the sheet on open and back to the row that opened it on
   close — a dialog that drops focus to the top of the document is unusable by
   keyboard. */
function openSheet() {
  state.sheet = true
  state.sheetTab = 'practice'
  state.confirmDelete = null
  render()
  document.querySelector('.sheet__list .sheet__check')?.focus()
}

function closeSheet() {
  // Nothing picked and nothing stored: there is no screen behind this worth
  // showing, so the dialog simply stays.
  if (state.firstRun && !state.selection.size) return
  state.sheet = false
  state.firstRun = false
  render()
  document.getElementById('selection')?.focus()
}

function bindSheet() {
  const sheet = app.querySelector('.sheet')
  if (!sheet) return

  for (const el of app.querySelectorAll('[data-close]')) {
    el.addEventListener('click', closeSheet)
  }

  const note = sheet.querySelector('.sheet__note')
  const refused = () => {
    note.textContent = 'Keep at least one selected — a round needs cards.'
  }

  const change = (ok) => {
    if (ok) {
      note.textContent = ''
      syncSheet()
    } else {
      refused()
    }
  }

  for (const btn of sheet.querySelectorAll('[data-set]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.set
      change(setSelected(id, !state.selection.has(id)))
    })
  }

  for (const btn of sheet.querySelectorAll('[data-tab]')) {
    btn.addEventListener('click', () => {
      state.sheetTab = btn.dataset.tab
      state.confirmDelete = null
      render()
      document.getElementById(`tab-${state.sheetTab}`)?.focus()
    })
  }

  /* Left and right move between tabs, which is what a tablist is expected to
     do and what a keyboard user will try. */
  for (const btn of sheet.querySelectorAll('[role="tab"]')) {
    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      state.sheetTab = state.sheetTab === 'practice' ? 'mine' : 'practice'
      state.confirmDelete = null
      render()
      document.getElementById(`tab-${state.sheetTab}`)?.focus()
    })
  }

  for (const btn of sheet.querySelectorAll('[data-edit]')) {
    btn.addEventListener('click', () => openBuilder(btn.dataset.edit))
  }

  for (const btn of sheet.querySelectorAll('[data-share]')) {
    btn.addEventListener('click', () => openShare(btn.dataset.share))
  }

  /* Two presses, not a confirm dialog: this panel is already a dialog, and a
     browser confirm is the kind of thing that gets clicked through. */
  for (const btn of sheet.querySelectorAll('[data-delete]')) {
    btn.addEventListener('click', () => {
      state.confirmDelete = btn.dataset.delete
      render()
      document.querySelector(`[data-reallydelete="${state.confirmDelete}"]`)?.focus()
    })
  }
  for (const btn of sheet.querySelectorAll('[data-keepset]')) {
    btn.addEventListener('click', () => {
      state.confirmDelete = null
      render()
    })
  }
  for (const btn of sheet.querySelectorAll('[data-reallydelete]')) {
    btn.addEventListener('click', () => deleteSet(btn.dataset.reallydelete))
  }

  document.getElementById('new-set')?.addEventListener('click', () => openBuilder(null))

  /* Escape closes, and Tab is kept inside — an aria-modal dialog that lets
     focus wander behind the scrim is lying about being modal. */
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      // Escape is a way out, and on the first run there is nothing to go out to.
      if (!state.firstRun) closeSheet()
      return
    }
    if (event.key !== 'Tab') return
    const stops = [...sheet.querySelectorAll('button:not([disabled])')]
    if (!stops.length) return
    const edge = event.shiftKey ? stops[0] : stops[stops.length - 1]
    if (document.activeElement === edge) {
      event.preventDefault()
      ;(event.shiftKey ? stops[stops.length - 1] : stops[0]).focus()
    }
  })
}

/* Kana labels only when the whole selection is kana. A mixed selection is
   genuinely both, and the kanji labels are the ones that describe the harder
   half of it. */
const selectionIsKana = () => {
  const chosen = selectedSets()
  return chosen.length > 0 && chosen.every((s) => s.section === KANA_SECTION)
}

function directionSwitch() {
  const kind = selectionIsKana() ? 'kana' : 'word'
  return `
    <div class="mode" role="group" aria-label="Practice direction">
      ${DIRECTIONS.map(
        (d) => `<button class="mode__btn ${state.direction === d.id ? 'is-active' : ''}"
                    data-direction="${d.id}" aria-pressed="${state.direction === d.id}"
                    title="${d.hint}">${d[kind]}</button>`
      ).join('')}
    </div>`
}

function bindDirectionSwitch() {
  for (const btn of app.querySelectorAll('.mode__btn')) {
    btn.addEventListener('click', () => {
      if (state.direction === btn.dataset.direction) return
      state.direction = btn.dataset.direction
      // Options are built from the answer face, so they must be rebuilt.
      if (state.screen === 'practice' && state.mode === 'choice' && !state.picked) {
        const card = state.round[state.index]
        state.choices = buildChoices(distractorPool(card), card, state.direction, CHOICE_COUNT)
      }
      render()
    })
  }
}

function progress() {
  const total = state.round.length
  const position = state.index + 1
  return `
    <div class="progress">
      <div class="progress__bar" role="progressbar"
           aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${position}"
           aria-valuetext="Card ${position} of ${total}">
        <div class="progress__fill" style="width: ${(position / total) * 100}%"></div>
      </div>
      <p class="progress__label">${position} of ${total}</p>
    </div>`
}

function practiceChrome() {
  return `
    <header class="topbar">
      ${navMenu()}
      ${tally()}
      ${settingsMenu()}
    </header>
    ${state.mode === 'trace' ? '' : directionSwitch()}
    ${progress()}`
}

function bindChrome() {
  bindMenus()
  bindDirectionSwitch()
}

/* Screens ---------------------------------------------------------------- */

function renderHome() {
  app.innerHTML = `
    <header class="topbar topbar--home">
      <span class="topbar__spacer"></span>
      <span class="topbar__spacer"></span>
      ${settingsMenu()}
    </header>
    <div class="home">
      <hgroup class="home__heading">
        <h1 class="home__title" lang="ja">漢字の練習</h1>
        <p class="home__tagline">Kanji Practice</p>
      </hgroup>
      ${
        isUpdateReady()
          ? `<div class="home__update" role="status">
               <p class="home__update-text">App update available</p>
               <button class="btn btn--update" id="update">Update</button>
             </div>`
          : ''
      }
      <button class="selection" id="selection" aria-haspopup="dialog"
              aria-expanded="${state.sheet ? 'true' : 'false'}">
        <span class="selection__text">
          <span class="selection__name">${escapeHtml(describeSelection())}</span>
          <span class="selection__count">${activeCards().length} cards</span>
        </span>
        ${icon('chevron', 'icon--chevron')}
      </button>
      <div class="home__modes">
        ${Object.entries(MODES)
          .map(
            ([id, m]) => `
              <button class="card-btn" data-start="${id}">
                <span class="card-btn__icon">${icon(m.icon)}</span>
                <span class="card-btn__label">${m.label}</span>
                <span class="card-btn__hint">${m.hint}</span>
              </button>`
          )
          .join('')}
      </div>
    </div>
    ${renderSheet()}`

  for (const btn of app.querySelectorAll('[data-start]')) {
    btn.addEventListener('click', () => setMode(btn.dataset.start))
  }
  document.getElementById('selection').addEventListener('click', openSheet)
  bindSheet()

  // Binds the gear, and the theme and palette switches inside it.
  bindMenus()

  const update = document.getElementById('update')
  if (update) update.addEventListener('click', applyUpdate)

  /* Every visit to the home screen is a chance to notice a new version. The
     answer arrives asynchronously, hence onUpdateReady below.

     Not while the sheet is open: every tick of a checkbox re-renders this
     screen, and each one would otherwise fire a service-worker update check. */
  if (!state.sheet) checkForUpdate()
}

function renderFlashcard() {
  const card = state.round[state.index]
  const side = faces(card)

  if (!state.revealed) {
    app.innerHTML = `
      ${practiceChrome()}
      <div class="stage">
        <p class="kana"${ja(side.prompt)}>${side.prompt}</p>
      </div>
      <div class="actions">
        <button class="btn" id="show">Show answer</button>
      </div>`
    bindChrome()
    document.getElementById('show').addEventListener('click', () => {
      state.revealed = true
      render()
    })
    return
  }

  app.innerHTML = `
    ${practiceChrome()}
    <div class="stage">
      <p class="kanji"${ja(side.answer)}>${side.answer}</p>
      <div class="gloss">
        ${card.meaning ? `<p class="meaning">${card.meaning}</p>` : ''}
        <p class="meaning meaning--reading"${ja(side.echo)}>${side.echo}</p>
      </div>
    </div>
    <div class="actions">
      <div class="judge">
        <button class="judge__btn is-good" id="right" aria-label="I got it right — next card">
          ${icon('check', 'icon--judge')}
        </button>
        <button class="judge__btn is-bad" id="wrong" aria-label="I got it wrong — next card">
          ${icon('cross', 'icon--judge')}
        </button>
      </div>
    </div>`
  bindChrome()
  document.getElementById('right').addEventListener('click', () => score('correct'))
  document.getElementById('wrong').addEventListener('click', () => score('incorrect'))
}

function renderChoice() {
  const card = state.round[state.index]
  const side = faces(card)
  const correctFace = side.answer
  const picked = state.picked
  const gotIt = picked === correctFace

  app.innerHTML = `
    ${practiceChrome()}
    <div class="stage stage--choice">
      <p class="kana kana--choice"${ja(side.prompt)}>${side.prompt}</p>
      ${
        /* A kana has no meaning, so there is no strip to reserve. Rendering an
           empty one leaves a blank gap that un-hides on pick and reads as a
           meaning that failed to load. */
        card.meaning
          ? `<p class="meaning ${picked ? '' : 'is-hidden'}">${card.meaning}</p>`
          : ''
      }
    </div>
    <div class="actions">
      ${
        picked
          ? `<div class="verdict ${gotIt ? 'verdict--good' : 'verdict--bad'}" role="status" aria-live="polite">
              <p class="verdict__text">
                ${
                  gotIt
                    ? `${icon('check', 'icon--verdict')} Correct`
                    : `${icon('cross', 'icon--verdict')} Not quite — it's <span${ja(correctFace)}>${correctFace}</span>`
                }
              </p>
              <button class="btn" id="continue">Continue</button>
            </div>`
          : '<div class="verdict verdict--empty"></div>'
      }
      <div class="choices">
        ${state.choices
          .map((option) => {
            const face = answerFace(option)
            const isCorrect = face === correctFace
            let cls = ''
            if (picked) {
              if (isCorrect) cls = 'is-correct'
              else if (face === picked) cls = 'is-wrong'
              else cls = 'is-dimmed'
            }
            let mark = ''
            if (picked && isCorrect) mark = icon('check', 'icon--mark')
            else if (picked && face === picked) mark = icon('cross', 'icon--mark')
            return `<button class="choice ${cls}" data-face="${face}"${ja(face)}
                      ${picked ? 'disabled' : ''}><span>${face}</span>${mark}</button>`
          })
          .join('')}
      </div>
    </div>`
  bindChrome()

  if (picked) {
    const next = document.getElementById('continue')
    next.addEventListener('click', () => score(gotIt ? 'correct' : 'incorrect'))
    next.focus()
    return
  }

  for (const btn of app.querySelectorAll('.choice')) {
    btn.addEventListener('click', () => {
      if (state.picked) return
      state.picked = btn.dataset.face
      render()
    })
  }
}

/* Trace mode. The reading is the prompt, as in かな → 漢字 — the difference is
   that recalling the written form means drawing it rather than saying it. The
   cell starts blank; "Show me" fades the ghost in and animates the current
   stroke, so asking for help is a deliberate act rather than the default.

   Everything inside the card is driven by mountTrace mutating the canvas in
   place. This function runs once per card, not once per stroke. */
function renderTrace() {
  const card = state.round[state.index]

  app.innerHTML = `
    ${practiceChrome()}
    <div class="stage stage--trace">
      <p class="kana kana--trace"${ja(card.reading)}>${card.reading}</p>
      <p class="trace__strip" lang="ja" aria-hidden="true">
        ${[...card.written].map((ch) => `<span class="trace__char">${ch}</span>`).join('')}
      </p>
      <div class="trace__cell">
        <canvas class="trace__canvas" role="img" aria-label="Tracing area"></canvas>
      </div>
      <p class="trace__status" role="status" aria-live="polite"></p>
    </div>
    <div class="actions">
      <div class="trace__buttons">
        <button class="btn btn--secondary" id="trace-show" aria-pressed="false">Show me</button>
        <button class="btn btn--secondary" id="trace-skip">Skip this one</button>
      </div>
      <p class="trace__credit">
        Stroke order from
        <a href="http://kanjivg.tagaini.net" target="_blank" rel="noreferrer">KanjiVG</a>,
        CC BY-SA 3.0
      </p>
    </div>`

  bindChrome()

  // Always reachable, and the only way through for anyone who cannot draw —
  // keyboard, screen reader, or a stroke the matcher and he disagree about.
  document.getElementById('trace-skip').addEventListener('click', () => score('incorrect'))

  teardownTrace = mountTrace(app, card, { onFinish: (kind) => score(kind) })
}

/* One result row. The written form leads at reading size and the reading sits
   beside it, muted — the same pair the old table showed, minus the table. */
function resultRow(card) {
  return `
    <li class="result">
      <span class="result__written" lang="ja">${card.written}</span>
      <span class="result__reading"${ja(card.reading)}>${card.reading}</span>
    </li>`
}

function resultList(list, tone) {
  return `<ul class="results__list results__list--${tone}">${list.map(resultRow).join('')}</ul>`
}

/* The score as an arc. Decorative — `scoreRing` is followed by the same figure
   in words, which is what a screen reader announces. */
function scoreRing(correct, total) {
  const r = 52
  const circumference = 2 * Math.PI * r
  const filled = total ? (correct / total) * circumference : 0
  return `
    <svg class="score__ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle class="score__track" cx="60" cy="60" r="${r}" />
      <circle class="score__arc" cx="60" cy="60" r="${r}"
              stroke-dasharray="${filled.toFixed(1)} ${circumference.toFixed(1)}" />
    </svg>`
}

function renderResults() {
  const correct = byStatus('correct')
  const missed = byStatus('incorrect')
  // The round, not every card that exists — a retry of seven missed cards must
  // report seven, not 743.
  const total = state.round.length
  const celebration = celebrationFor(correct.length, total)

  /* With nothing missed the correct list is the only list, so it is shown
     outright; otherwise it folds away behind a summary, because the missed
     cards are what the retry button acts on. */
  const correctSection = !correct.length
    ? ''
    : missed.length
      ? `<details class="results__fold">
           <summary class="results__summary">
             ${icon('check', 'icon--caption is-good')}
             <span>${correct.length} correct</span>
           </summary>
           ${resultList(correct, 'good')}
         </details>`
      : `<div class="results__group">
           <h2 class="results__caption is-good">
             ${icon('check', 'icon--caption')} Correct (${correct.length})
           </h2>
           ${resultList(correct, 'good')}
         </div>`

  app.innerHTML = `
    <header class="topbar topbar--results">
      ${navMenu()}
      <span class="topbar__spacer"></span>
      ${settingsMenu()}
    </header>
    <div class="results">
      <div class="score" role="status" aria-live="polite">
        <div class="score__dial">
          ${scoreRing(correct.length, total)}
          <p class="score__figure">
            <span class="score__count">${correct.length}</span>
            <span class="score__total">of ${total}</span>
          </p>
        </div>
        <p class="results__label ${missed.length ? '' : 'is-good'}">
          ${icon('spark', 'icon--spark')} ${celebration.message}
        </p>
        <span class="visually-hidden">${correct.length} of ${total} correct</span>
      </div>

      <div class="results__body">
        ${
          missed.length
            ? `<div class="results__group">
                 <h2 class="results__caption is-bad">
                   ${icon('cross', 'icon--caption')} Missed (${missed.length})
                 </h2>
                 ${resultList(missed, 'bad')}
               </div>`
            : ''
        }
        ${correctSection}
      </div>
    </div>
    <div class="actions">
      ${
        missed.length
          ? `<button class="btn" id="retry">Practice the ${missed.length} you missed</button>`
          : ''
      }
      <button class="btn btn--secondary" id="restart">Start over</button>
    </div>`

  bindMenus()
  if (missed.length) {
    document.getElementById('retry').addEventListener('click', practiceMissed)
  }
  document.getElementById('restart').addEventListener('click', restart)

  // Something for every round with at least one right, more of it the better
  // the score. A zero-score round gets none.
  if (celebration.level > 0) confetti(celebration.level)
}

/* Trace mode owns a canvas and a pointer capture that must not outlive the DOM
   they belong to. render() destroys that DOM wholesale, so it tears the trace
   down first — otherwise opening the menu mid-stroke strands an animation frame
   and a captured pointer. */
let teardownTrace = null

function render() {
  teardownTrace?.()
  teardownTrace = null
  if (state.screen === 'home') return renderHome()
  if (state.screen === 'builder') return renderBuilder()
  if (state.screen === 'share') return renderShare()
  if (state.screen === 'receive') return renderReceive()
  if (state.screen === 'results') return renderResults()
  if (state.mode === 'trace') return renderTrace()
  return state.mode === 'choice' ? renderChoice() : renderFlashcard()
}

/* An update found after the home screen has drawn re-renders it, so the button
   appears without him having to leave and come back. Only on the home screen:
   nothing interrupts a round in progress. */
onUpdateReady(() => {
  if (state.screen === 'home') render()
})

/* Read before anything else and removed from the address bar immediately, so a
   reload — including the one `applyUpdate()` does to install a new service
   worker — cannot offer the same link a second time. */
const sharedPayload = takeSharedFromUrl()

/* Order matters. The sets the user made have to exist before loadPrefs
   validates a stored selection against them, or a selection naming one is
   dropped as unknown — and if it was the only entry, the app decides this
   person has never chosen and shows them the first-run picker. */
loadUserSets()
rebuildMembership()
loadPrefs()

if (sharedPayload) {
  /* A shared link beats the first-run picker. It is why they opened the app,
     and saving the set satisfies the same requirement the picker exists to
     enforce. `firstRun` is left set, so declining still lands them there. */
  state.incoming = { state: 'loading' }
  state.screen = 'receive'
  state.sheet = false
}

render()
if (sharedPayload) receiveShared(sharedPayload)

/* A link opened while the app is already on screen changes the fragment
   without reloading, so boot never runs again and the set would be ignored.
   Found by driving it: navigating from the app to one of its own share links
   did nothing at all. */
addEventListener('hashchange', () => {
  const payload = takeSharedFromUrl()
  if (!payload) return
  state.incoming = { state: 'loading' }
  state.screen = 'receive'
  state.sheet = false
  render()
  receiveShared(payload)
})
