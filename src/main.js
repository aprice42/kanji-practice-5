import { cards as rawCards } from './cards.js'
import { shuffle, facesOf, buildChoices } from './choices.js'
import { confetti } from './confetti.js'
import './style.css'

// Stable id per card so a card's status survives across practice rounds.
const cards = rawCards.map((card, id) => ({ ...card, id }))

const app = document.getElementById('app')

const CHOICE_COUNT = 3

const MODES = {
  flashcards: { label: 'Flash cards', icon: 'cards', hint: 'Show the answer, then mark yourself' },
  choice: { label: 'Multiple choice', icon: 'choice', hint: 'Pick the right answer from three' },
}

/* Icons -------------------------------------------------------------------
   Inline SVG on a 48x48 grid, stroked with currentColor so every mark takes
   the active palette. Correct and wrong differ in shape as well as colour.
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
  menu:
    '<path d="M9 15h30M9 24h30M9 33h30" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
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
}

/* Theme ------------------------------------------------------------------ */

const THEME_KEY = 'kanji-practice:theme'
const PALETTE_KEY = 'kanji-practice:palette'

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
  } catch {
    // Private browsing or blocked storage — stay on the defaults.
  }
  applyTheme()
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
    <div class="palette" role="group" aria-label="Colour scheme">
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
    <div class="theme" role="group" aria-label="Colour theme">
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

function byStatus(kind) {
  return cards.filter((card) => state.status.get(card.id) === kind)
}

function prepareCard() {
  state.revealed = false
  state.picked = null
  state.choices =
    state.mode === 'choice'
      ? buildChoices(cards, state.deck[state.index], state.direction, CHOICE_COUNT)
      : []
}

function startRound(deck) {
  state.deck = shuffle(deck)
  state.index = 0
  state.screen = 'practice'
  prepareCard()
  render()
}

function restart() {
  state.status.clear()
  startRound(cards)
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

function menu() {
  const other = state.mode === 'flashcards' ? 'choice' : 'flashcards'
  return `
    <div class="menu">
      <button class="menu__trigger" id="menu-trigger" aria-haspopup="true"
              aria-expanded="false" aria-controls="menu-panel">
        ${icon('menu', 'icon--menu')}
        <span class="visually-hidden">Menu</span>
      </button>
      <div class="menu__panel" id="menu-panel" role="menu" hidden>
        <p class="menu__heading" id="menu-heading">Switch mode</p>
        <button role="menuitem" data-act="mode:${other}">
          ${icon(MODES[other].icon, 'icon--menu-item')} ${MODES[other].label}
        </button>
        <hr />
        <p class="menu__heading">Theme</p>
        ${themeSwitch()}
        <p class="menu__heading">Colour scheme</p>
        ${paletteSwitch()}
        <hr />
        <button role="menuitem" data-act="restart">Start over</button>
        <button role="menuitem" data-act="home">Home</button>
      </div>
    </div>`
}

function bindMenu() {
  const trigger = document.getElementById('menu-trigger')
  if (!trigger) return
  const panel = document.getElementById('menu-panel')

  const close = () => {
    panel.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('click', onOutside, true)
    document.removeEventListener('keydown', onKey)
  }
  const onOutside = (event) => {
    if (!event.target.closest('.menu')) close()
  }
  const onKey = (event) => {
    if (event.key === 'Escape') {
      close()
      trigger.focus()
    }
  }

  trigger.addEventListener('click', () => {
    if (panel.hidden) {
      panel.hidden = false
      trigger.setAttribute('aria-expanded', 'true')
      panel.querySelector('button').focus()
      document.addEventListener('click', onOutside, true)
      document.addEventListener('keydown', onKey)
    } else {
      close()
    }
  })

  bindThemeSwitch()
  bindPaletteSwitch()

  for (const item of panel.querySelectorAll('[data-act]')) {
    item.addEventListener('click', () => {
      const act = item.dataset.act
      close()
      if (act === 'restart') restart()
      else if (act === 'home') goHome()
      else if (act.startsWith('mode:')) setMode(act.slice(5))
    })
  }
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
        state.choices = buildChoices(cards, state.deck[state.index], state.direction, CHOICE_COUNT)
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
      ${menu()}
      ${tally()}
      <span class="topbar__spacer"></span>
    </header>
    ${directionSwitch()}
    ${progress()}`
}

function bindChrome() {
  bindMenu()
  bindDirectionSwitch()
}

/* Screens ---------------------------------------------------------------- */

function renderHome() {
  app.innerHTML = `
    <div class="home">
      <h1 class="home__title" lang="ja">漢字の練習</h1>
      <p class="home__subtitle">${cards.length} cards · pick a mode to start</p>
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
      <div class="home__settings">
        <div>
          <p class="home__direction-label">Direction</p>
          ${directionSwitch()}
        </div>
        <div>
          <p class="home__direction-label">Theme</p>
          ${themeSwitch()}
        </div>
      </div>
      <div class="home__palette">
        <p class="home__direction-label">Colour scheme</p>
        ${paletteSwitch()}
      </div>
    </div>`

  for (const btn of app.querySelectorAll('[data-start]')) {
    btn.addEventListener('click', () => setMode(btn.dataset.start))
  }
  bindDirectionSwitch()
  bindThemeSwitch()
  bindPaletteSwitch()
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

function table(caption, list, tone) {
  if (!list.length) return ''
  return `
    <table class="results__table">
      <caption class="${tone}">${caption}</caption>
      <thead class="visually-hidden">
        <tr><th scope="col">Reading</th><th scope="col">Written form</th></tr>
      </thead>
      <tbody>
        ${list
          .map(
            (card) => `<tr>
              <td lang="ja">${card.reading}</td>
              <td lang="ja">${card.written}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>`
}

function renderResults() {
  const correct = byStatus('correct')
  const missed = byStatus('incorrect')

  app.innerHTML = `
    <header class="topbar topbar--results">
      ${menu()}
      ${tally()}
      <span class="topbar__spacer"></span>
    </header>
    <div class="results">
      <p class="results__label ${missed.length ? '' : 'is-good'}">
        ${
          missed.length
            ? `${missed.length} still to get`
            : `${icon('spark', 'icon--spark')} Way to Go!`
        }
      </p>
      <div class="results__tables">
        ${table(`${icon('cross', 'icon--caption')} Missed (${missed.length})`, missed, 'is-bad')}
        ${table(`${icon('check', 'icon--caption')} Correct (${correct.length})`, correct, 'is-good')}
      </div>
    </div>
    <div class="actions">
      ${
        missed.length
          ? `<button class="btn" id="retry">Practice the ${missed.length} missed</button>`
          : ''
      }
      <button class="btn btn--secondary" id="restart">Start over</button>
    </div>`

  bindMenu()
  if (missed.length) {
    document.getElementById('retry').addEventListener('click', practiceMissed)
  }
  document.getElementById('restart').addEventListener('click', restart)

  if (!missed.length) confetti()
}

function render() {
  if (state.screen === 'home') return renderHome()
  if (state.screen === 'results') return renderResults()
  return state.mode === 'choice' ? renderChoice() : renderFlashcard()
}

loadPrefs()
render()
