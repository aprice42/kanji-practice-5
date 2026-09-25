import { cards as rawCards, SETS } from './cards.js'
import { shuffle, facesOf, buildChoices } from './choices.js'
import { confetti } from './confetti.js'
import { mountTrace } from './trace.js'
import { isUpdateReady, onUpdateReady, checkForUpdate, applyUpdate } from './update.js'
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

const CHOICE_COUNT = 3

/* Below this many cards a multiple-choice question cannot be disguised — there
   are not enough same-shaped words to hide the answer among — so distractors
   are drawn from the card's whole grade instead of the selection. */
const MIN_POOL = 8

const DEFAULT_SELECTION = ['w:2025-09-review']

/* Sets ---------------------------------------------------------------------
   A set is a named selection of cards — a whole grade, a worksheet, or later
   something hand-built. SETS is generated alongside the cards with its labels
   and counts already resolved, so nothing here derives a label by splitting an
   id, and the app never evaluates what "grade 4" means.
   --------------------------------------------------------------------------- */

/* A set with nothing filled in yet is listed but cannot be chosen. Showing it
   as `0` would look like a bug, and leaving it out would hide that it exists. */
const isPlayable = (set) => set.cards > 0
const playableSets = SETS.filter(isPlayable)

/* Sections, in the order the picker shows them, taken from the manifest so a
   new kind of set — kana, custom — appears without touching this file. */
const SECTIONS = [...new Set(SETS.map((s) => s.section))].sort(
  (a, b) => (a === 'Curriculum' ? -1 : b === 'Curriculum' ? 1 : 0)
)
const setsIn = (section) => SETS.filter((s) => s.section === section)

/* Display order: by section, then as the manifest lists them. Used by both the
   picker and the summary row, so "Grade 4 & September review" cannot come out
   in one order on the home screen and the other in the panel. */
const DISPLAY_ORDER = SECTIONS.flatMap(setsIn)

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
  selection: new Set(DEFAULT_SELECTION),
  // Ephemeral, never persisted: true while the picker is open.
  sheet: false,
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

    /* Validated against the manifest, not trusted. A set can disappear when the
       master list is re-ingested or a worksheet is renamed, and a stored id
       that no longer resolves would leave a round with no cards in it. Unknown
       ids are dropped; if nothing survives, the default comes back. */
    const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null')
    if (Array.isArray(saved)) {
      const known = saved.map(migrateSetId).filter((id) => playableSets.some((s) => s.id === id))
      if (known.length) state.selection = new Set(known)
    }
  } catch {
    // Private browsing or blocked storage — stay on the defaults.
  }
  applyTheme()
}

/* Grades used to be four decks each — `g4:1` … `g4:4` — and are now one set.
   A stored id from that era is mapped to its grade rather than dropped: the
   validation above would discard it safely, but the selection would then fall
   back to the September worksheet without a word, which reads as the app
   forgetting what he chose. A quarter of a grade becomes the whole grade, the
   nearest honest equivalent. */
const migrateSetId = (id) => (/^(g[1-5]|ch):\d+$/.test(id) ? id.split(':')[0] : id)

function saveSelection() {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify([...state.selection]))
  } catch {
    // Not persisting is survivable; the choice still applies for this session.
  }
}

/* Selection --------------------------------------------------------------- */

/* A card belongs to one or more sets, so membership is a test rather than a
   lookup. Cheap enough to run per round and per card: 794 cards, one set each
   today, a handful once they overlap. */
const activeCards = () => cards.filter((card) => card.sets.some((id) => state.selection.has(id)))

const selectedSets = () =>
  DISPLAY_ORDER.filter((s) => isPlayable(s) && state.selection.has(s.id))

/* The last selected set cannot be turned off. An empty selection would mean a
   round with no cards, so rather than disabling every mode and explaining why,
   the state is simply made unreachable. Returns false when it refused, which is
   what the picker announces. */
function setSelected(id, on) {
  if (on) {
    state.selection.add(id)
  } else {
    if (state.selection.size <= 1) return false
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
  return `
    <button class="sheet__check" role="checkbox" aria-checked="${checked}"
            ${ready ? '' : 'disabled'} data-set="${set.id}">
      <span class="sheet__box">${icon(BOX[checked], 'icon--box')}</span>
      <span class="sheet__label">${set.label}</span>
      <span class="sheet__count ${ready ? '' : 'is-muted'}">${ready ? set.cards : 'not ready'}</span>
      <span class="visually-hidden">${ready ? `${set.cards} cards` : 'no cards yet'}</span>
    </button>`
}

function renderSheet() {
  if (!state.sheet) return ''
  return `
    <div class="sheet-scrim" data-close></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <h2 class="sheet__title" id="sheet-title">What to practice</h2>
      <div class="sheet__list">
        ${SECTIONS.map(
          (section) => `
          <p class="menu__heading">${section}</p>
          ${setsIn(section).map(setRow).join('')}`
        ).join('')}
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
  state.sheet = true
  render()
  document.querySelector('.sheet__list .sheet__check')?.focus()
}

function closeSheet() {
  state.sheet = false
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
  const card = state.round[state.index]
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
  const card = state.round[state.index]
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
  const card = state.round[state.index]

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
