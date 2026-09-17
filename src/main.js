import { cards as rawCards, DECKS } from './cards.js'
import { shuffle, facesOf, buildChoices } from './choices.js'
import { confetti } from './confetti.js'
import { mountTrace } from './trace.js'
import { isUpdateReady, onUpdateReady, checkForUpdate, applyUpdate } from './update.js'
import './style.css'

// Stable id per card so a card's status survives across practice rounds.
const cards = rawCards.map((card, id) => ({ ...card, id }))

const app = document.getElementById('app')

const CHOICE_COUNT = 3

/* Below this many cards a multiple-choice question cannot be disguised — there
   are not enough same-shaped words to hide the answer among — so distractors
   are drawn from the card's whole grade instead of the selection. */
const MIN_POOL = 8

const DEFAULT_SELECTION = ['w:2025-09-review']

/* Decks -------------------------------------------------------------------
   DECKS is generated alongside the cards, so labels and counts are never
   derived here by string-splitting an id.
   ------------------------------------------------------------------------- */

const deckById = new Map(DECKS.map((d) => [d.id, d]))

/* A deck with nothing filled in yet is listed but cannot be chosen. Showing it
   as `0` would look like a bug, and leaving it out would hide the fact that the
   grade exists at all. */
const isPlayable = (deck) => deck.cards > 0
const playableDecks = DECKS.filter(isPlayable)

const cardsByDeck = new Map()
for (const card of cards) {
  if (!cardsByDeck.has(card.deck)) cardsByDeck.set(card.deck, [])
  cardsByDeck.get(card.deck).push(card)
}

/* Grade order as the sheet prints it. `ch` is the sixth tier listed past grade
   5 — not "grade 6", which would claim something the sheet does not say. */
const GRADE_ORDER = [1, 2, 3, 4, 5, 'ch']
const gradeDecks = (grade) => DECKS.filter((d) => d.grade === grade)
const worksheetDecks = DECKS.filter((d) => d.grade === null)

/* "Grade 4 · Group 2" → "Grade 4". Taken from the manifest rather than written
   out again here, so the two can never disagree. */
const gradeLabel = (grade) => gradeDecks(grade)[0]?.label.split(' · ')[0] ?? String(grade)

/* The first character of the first and last written form in a group — 曜–黄 —
   which is how the school's own sheet says where a stretch of the list starts
   and stops. */
function rangeOf(deckId) {
  const list = cardsByDeck.get(deckId) ?? []
  if (!list.length) return ''
  const first = [...list[0].written][0]
  const last = [...list[list.length - 1].written][0]
  return first === last ? first : `${first}–${last}`
}

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
  /* The three selection states differ in SHAPE, not only in colour: empty,
     ticked, and a bar for "some of this grade". A partial state carried by a
     tint alone is invisible to anyone who cannot separate the two colours. */
  box:
    '<rect x="10" y="10" width="28" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>',
  boxCheck:
    '<rect x="10" y="10" width="28" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M17 24l5 5 9-11" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
  boxDash:
    '<rect x="10" y="10" width="28" height="28" rx="5" fill="none" stroke="currentColor" stroke-width="3"/>' +
    '<path d="M17 24h14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
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

const DIRECTIONS = [
  { id: 'reading-first', label: 'かな → 漢字', hint: 'See the reading, recall the written form' },
  { id: 'written-first', label: '漢字 → かな', hint: 'See the written form, recall the reading' },
]

const state = {
  screen: 'home', // 'home' | 'practice' | 'results'
  mode: 'flashcards', // 'flashcards' | 'choice'
  direction: 'reading-first',
  // id -> 'correct' | 'incorrect'. The source of truth for the score: a card
  // answered wrong in round 1 and right in round 2 simply flips to 'correct'.
  status: new Map(),
  deck: [],
  index: 0,
  revealed: false,
  choices: [], // multiple-choice options for the current card
  picked: null, // the option the user tapped, until they continue
  theme: 'system', // 'system' | 'light' | 'dark'
  palette: 'indigo',
  /* Deck ids, persisted. Ids are content-derived (`g4:2`, `w:2025-09-review`)
     and survive a row being inserted; a card's `id` is its array index and
     would rot the moment the list is edited, which is why nothing persisted
     here is ever keyed on one. */
  selection: new Set(DEFAULT_SELECTION),
  /* Ephemeral, never persisted: null when the sheet is closed, otherwise the
     set of grades expanded inside it. */
  sheet: null,
}

/* Theme ------------------------------------------------------------------ */

const THEME_KEY = 'kanji-practice:theme'
const PALETTE_KEY = 'kanji-practice:palette'
const SELECTION_KEY = 'kanji-practice:selection'

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

    /* Validated against the manifest, not trusted. A deck can disappear when
       the master list is re-ingested or a worksheet is renamed, and a stored id
       that no longer resolves would leave a round with no cards in it. Unknown
       ids are dropped; if nothing survives, the default comes back. */
    const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null')
    if (Array.isArray(saved)) {
      const known = saved.filter((id) => playableDecks.some((d) => d.id === id))
      if (known.length) state.selection = new Set(known)
    }
  } catch {
    // Private browsing or blocked storage — stay on the defaults.
  }
  applyTheme()
}

function saveSelection() {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...state.selection]))
  } catch {
    // Not persisting is survivable; the choice still applies for this session.
  }
}

/* Selection --------------------------------------------------------------- */

const activeCards = () => cards.filter((card) => state.selection.has(card.deck))

const selectedDecks = () => playableDecks.filter((d) => state.selection.has(d.id))

const gradeIsWhole = (grade) =>
  gradeDecks(grade).filter(isPlayable).every((d) => state.selection.has(d.id))

const gradeState = (grade) => {
  const decks = gradeDecks(grade).filter(isPlayable)
  const on = decks.filter((d) => state.selection.has(d.id)).length
  return on === 0 ? 'false' : on === decks.length ? 'true' : 'mixed'
}

/* The last selected deck cannot be turned off. An empty selection would mean a
   round with no cards, so rather than disabling every mode and explaining why,
   the state is simply made unreachable. Returns false when it refused, which is
   what the sheet announces. */
function setDeck(id, on) {
  if (on) {
    state.selection.add(id)
  } else {
    if (state.selection.size <= 1) return false
    state.selection.delete(id)
  }
  saveSelection()
  return true
}

function setGrade(grade, on) {
  const ids = gradeDecks(grade).filter(isPlayable).map((d) => d.id)
  if (on) {
    for (const id of ids) state.selection.add(id)
  } else {
    const remaining = [...state.selection].filter((id) => !ids.includes(id))
    if (!remaining.length) return false
    state.selection = new Set(remaining)
  }
  saveSelection()
  return true
}

/* "1, 2, 3" → "1–3"; "1, 3" stays "1, 3". A run of two is written out rather
   than dashed, because "Groups 1–2" and "Groups 1, 2" are the same length and
   the second is unambiguous. */
function rangeList(numbers) {
  const parts = []
  for (let i = 0; i < numbers.length; ) {
    let j = i
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j] + 1) j++
    parts.push(j - i >= 2 ? `${numbers[i]}–${numbers[j]}` : numbers.slice(i, j + 1).join(', '))
    i = j + 1
  }
  return parts.join(', ')
}

const listJoin = (items) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`

/* What the home screen's summary row says. Names what was chosen whenever it
   can be named, and falls back to counting only when the selection is too
   scattered for a phrase to be shorter than the list. */
function describeSelection() {
  const selected = selectedDecks()
  if (!selected.length) return 'Nothing selected'

  const sheets = selected.filter((d) => d.grade === null).map((d) => d.label)
  const grades = GRADE_ORDER.filter((g) => selected.some((d) => d.grade === g))

  // "Grades 3 & 4" — only when whole grades, and only numbered ones, since
  // "Grades 3 & Challenge" is not a sentence.
  if (
    !sheets.length &&
    grades.length > 1 &&
    grades.every((g) => typeof g === 'number' && gradeIsWhole(g))
  ) {
    return `Grades ${listJoin(grades.map(String))}`
  }

  const parts = [...sheets]
  for (const g of grades) {
    if (gradeIsWhole(g)) {
      parts.push(gradeLabel(g))
      continue
    }
    const groups = selected
      .filter((d) => d.grade === g)
      .map((d) => d.group)
      .sort((a, b) => a - b)
    parts.push(`${gradeLabel(g)} · Group${groups.length > 1 ? 's' : ''} ${rangeList(groups)}`)
  }
  return parts.length <= 2 ? listJoin(parts) : `${selected.length} groups`
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
  return state.deck.filter((card) => state.status.get(card.id) === kind)
}

/* Where a multiple-choice question's wrong answers come from.

   Normally the selection, because a distractor is only convincing if it is
   something the child is actually studying. But a question needs same-shaped
   words to hide the answer among, and a single group can be as small as seven —
   at that size the correct option is often the only one whose okurigana fits
   the prompt, which is answerable without reading any kanji at all. So a small
   selection widens to the card's whole grade. `npm run audit` measures exactly
   this, per deck. */
function distractorPool(card) {
  const active = activeCards()
  if (active.length >= MIN_POOL) return active
  const grade = deckById.get(card.deck)?.grade
  if (grade == null) return active
  const wider = cards.filter((c) => deckById.get(c.deck)?.grade === grade)
  return wider.length > active.length ? wider : active
}

function prepareCard() {
  state.revealed = false
  state.picked = null
  const card = state.deck[state.index]
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
function startRound(deck) {
  state.deck = shuffle(deck)
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
  if (state.mode === mode && state.screen === 'practice') return
  state.mode = mode
  restart()
}

function score(kind) {
  state.status.set(state.deck[state.index].id, kind)
  if (state.index + 1 >= state.deck.length) {
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

const BOX = { true: 'boxCheck', false: 'box', mixed: 'boxDash' }

function sheetCheck({ checked, label, count, ready = true, range = '', data, cls = '' }) {
  const countText = ready ? String(count) : 'not ready'
  return `
    <button class="sheet__check ${cls}" role="checkbox" aria-checked="${checked}"
            ${ready ? '' : 'disabled'} ${data}>
      <span class="sheet__box">${icon(BOX[checked], 'icon--box')}</span>
      <span class="sheet__label">${label}</span>
      ${range ? `<span class="sheet__range" lang="ja">${range}</span>` : ''}
      <span class="sheet__count ${ready ? '' : 'is-muted'}">${countText}</span>
      <span class="visually-hidden">${ready ? `${count} cards` : 'no cards yet'}</span>
    </button>`
}

function sheetGradeRow(grade) {
  const decks = gradeDecks(grade)
  const playable = decks.filter(isPlayable)
  const total = playable.reduce((n, d) => n + d.cards, 0)
  const expanded = state.sheet.has(String(grade))
  const id = `sheet-groups-${grade}`
  const label = gradeLabel(grade)

  return `
    <div class="sheet__row">
      ${sheetCheck({
        checked: gradeState(grade),
        label,
        count: total,
        ready: playable.length > 0,
        data: `data-grade="${grade}"`,
      })}
      <button class="sheet__expand" aria-expanded="${expanded}" aria-controls="${id}"
              data-expand="${grade}">
        ${icon('chevron', 'icon--chevron')}
        <span class="visually-hidden">${expanded ? 'Hide' : 'Show'} ${label} groups</span>
      </button>
    </div>
    <div class="sheet__groups" id="${id}" ${expanded ? '' : 'hidden'}>
      ${decks
        .map((d) =>
          sheetCheck({
            checked: String(state.selection.has(d.id)),
            label: `Group ${d.group}`,
            count: d.cards,
            ready: isPlayable(d),
            range: rangeOf(d.id),
            data: `data-deck="${d.id}"`,
            cls: 'sheet__check--group',
          })
        )
        .join('')}
    </div>`
}

function renderSheet() {
  if (!state.sheet) return ''
  return `
    <div class="sheet-scrim" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 class="sheet__title" id="sheet-title">What to practice</h2>
      <div class="sheet__list">
        <p class="menu__heading">Grades</p>
        ${GRADE_ORDER.map(sheetGradeRow).join('')}
        <p class="menu__heading">Worksheets</p>
        ${worksheetDecks
          .map((d) =>
            sheetCheck({
              checked: String(state.selection.has(d.id)),
              label: d.label,
              count: d.cards,
              ready: isPlayable(d),
              data: `data-deck="${d.id}"`,
            })
          )
          .join('')}
      </div>
      <p class="sheet__note" role="status" aria-live="polite"></p>
      <div class="sheet__foot">
        <button class="btn" data-close>Done · ${activeCards().length} cards</button>
      </div>
    </section>`
}

/* Ticking a box updates the controls in place rather than re-rendering.

   Re-rendering was the obvious thing and it was wrong: render() replaces the
   home screen wholesale, so every tick built a new .sheet, which restarted its
   entry animation and repainted the screen behind it. It read as a flash on
   every click. The theme and palette switches already avoid this for the same
   reason — see setTheme — so this follows them.

   Everything that can disagree is updated here: each box, the grade boxes that
   summarise their groups, the Done count, and the summary row behind the
   scrim. */
function syncSheet() {
  const setBox = (btn, checked) => {
    btn.setAttribute('aria-checked', checked)
    btn.querySelector('.sheet__box').innerHTML = icon(BOX[checked], 'icon--box')
  }

  for (const btn of app.querySelectorAll('.sheet [data-deck]')) {
    setBox(btn, String(state.selection.has(btn.dataset.deck)))
  }
  for (const btn of app.querySelectorAll('.sheet [data-grade]')) {
    const g = btn.dataset.grade === 'ch' ? 'ch' : Number(btn.dataset.grade)
    setBox(btn, gradeState(g))
  }

  const count = activeCards().length
  const done = app.querySelector('.sheet__foot .btn')
  if (done) done.textContent = `Done · ${count} cards`

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
  state.sheet = new Set()
  render()
  document.querySelector('.sheet__list .sheet__check')?.focus()
}

function closeSheet() {
  state.sheet = null
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

  for (const btn of sheet.querySelectorAll('[data-deck]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.deck
      change(setDeck(id, !state.selection.has(id)))
    })
  }

  for (const btn of sheet.querySelectorAll('[data-grade]')) {
    btn.addEventListener('click', () => {
      const g = btn.dataset.grade === 'ch' ? 'ch' : Number(btn.dataset.grade)
      change(setGrade(g, gradeState(g) !== 'true'))
    })
  }

  /* Expanding is also in place — hiding a group list is not worth rebuilding
     the screen for. state.sheet still records which grades are open, so a real
     re-render (a theme change with the sheet up) restores them. */
  for (const btn of sheet.querySelectorAll('[data-expand]')) {
    btn.addEventListener('click', () => {
      const grade = btn.dataset.expand
      const open = !state.sheet.has(grade)
      if (open) state.sheet.add(grade)
      else state.sheet.delete(grade)
      const groups = sheet.querySelector(`#sheet-groups-${grade}`)
      if (groups) groups.hidden = !open
      btn.setAttribute('aria-expanded', String(open))
      const label = btn.querySelector('.visually-hidden')
      if (label) label.textContent = `${open ? 'Hide' : 'Show'} ${gradeLabel(
        grade === 'ch' ? 'ch' : Number(grade)
      )} groups`
    })
  }

  /* Escape closes, and Tab is kept inside — an aria-modal dialog that lets
     focus wander behind the scrim is lying about being modal. */
  sheet.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeSheet()
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

function directionSwitch() {
  return `
    <div class="mode" role="group" aria-label="Practice direction">
      ${DIRECTIONS.map(
        (d) => `<button class="mode__btn ${state.direction === d.id ? 'is-active' : ''}"
                    data-direction="${d.id}" aria-pressed="${state.direction === d.id}"
                    title="${d.hint}" lang="ja">${d.label}</button>`
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
        const card = state.deck[state.index]
        state.choices = buildChoices(distractorPool(card), card, state.direction, CHOICE_COUNT)
      }
      render()
    })
  }
}

function progress() {
  const total = state.deck.length
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
          <span class="selection__name">${describeSelection()}</span>
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
  const card = state.deck[state.index]
  const side = faces(card)

  if (!state.revealed) {
    app.innerHTML = `
      ${practiceChrome()}
      <div class="stage">
        <p class="kana" lang="ja">${side.prompt}</p>
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
      <p class="kanji" lang="ja">${side.answer}</p>
      <div class="gloss">
        <p class="meaning">${card.meaning}</p>
        <p class="meaning meaning--reading" lang="ja">${side.echo}</p>
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
  const card = state.deck[state.index]
  const side = faces(card)
  const correctFace = side.answer
  const picked = state.picked
  const gotIt = picked === correctFace

  app.innerHTML = `
    ${practiceChrome()}
    <div class="stage stage--choice">
      <p class="kana kana--choice" lang="ja">${side.prompt}</p>
      <p class="meaning ${picked ? '' : 'is-hidden'}">${card.meaning}</p>
    </div>
    <div class="actions">
      ${
        picked
          ? `<div class="verdict ${gotIt ? 'verdict--good' : 'verdict--bad'}" role="status" aria-live="polite">
              <p class="verdict__text">
                ${
                  gotIt
                    ? `${icon('check', 'icon--verdict')} Correct`
                    : `${icon('cross', 'icon--verdict')} Not quite — it's <span lang="ja">${correctFace}</span>`
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
            return `<button class="choice ${cls}" data-face="${face}" lang="ja"
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
  const card = state.deck[state.index]

  app.innerHTML = `
    ${practiceChrome()}
    <div class="stage stage--trace">
      <p class="kana kana--trace" lang="ja">${card.reading}</p>
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
      <span class="result__reading" lang="ja">${card.reading}</span>
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
  const total = state.deck.length
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

loadPrefs()
render()
