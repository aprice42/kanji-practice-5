import { cards } from './cards.js'
import './style.css'

const app = document.getElementById('app')

const state = {
  deck: [],
  index: 0,
  correct: 0,
  incorrect: 0,
  revealed: false,
  done: false,
}

function shuffle(list) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function restart() {
  state.deck = shuffle(cards)
  state.index = 0
  state.correct = 0
  state.incorrect = 0
  state.revealed = false
  state.done = false
  render()
}

function choose(kind) {
  if (kind === 'correct') state.correct++
  else state.incorrect++
  state.revealed = false
  if (state.index + 1 >= state.deck.length) state.done = true
  else state.index++
  render()
}

function tally() {
  return `
    <div class="tally" role="status" aria-live="polite">
      <span class="tally__group">
        <span class="tally__icon" aria-hidden="true">✅</span>
        <span class="tally__count">${state.correct}</span>
        <span class="visually-hidden">correct</span>
      </span>
      <span class="tally__group">
        <span class="tally__count">${state.incorrect}</span>
        <span class="tally__icon" aria-hidden="true">🚫</span>
        <span class="visually-hidden">incorrect</span>
      </span>
    </div>`
}

function render() {
  if (state.done) {
    const total = state.deck.length
    app.innerHTML = `
      ${tally()}
      <div class="stage stage--results">
        <p class="results__score">${state.correct} / ${total}</p>
        <p class="results__label">cards correct</p>
      </div>
      <div class="actions">
        <button class="btn" id="restart">🔄 Start over</button>
      </div>`
    document.getElementById('restart').addEventListener('click', restart)
    app.querySelector('.btn').focus()
    return
  }

  const card = state.deck[state.index]

  if (!state.revealed) {
    app.innerHTML = `
      ${tally()}
      <div class="stage">
        <p class="kana" lang="ja">${card.reading}</p>
      </div>
      <div class="actions">
        <button class="btn" id="show">Show answer</button>
      </div>`
    document.getElementById('show').addEventListener('click', () => {
      state.revealed = true
      render()
    })
    return
  }

  app.innerHTML = `
    ${tally()}
    <div class="stage">
      <p class="kanji" lang="ja">${card.written}</p>
      <div class="gloss">
        <p class="meaning">${card.meaning}</p>
        <p class="meaning meaning--reading" lang="ja">${card.reading}</p>
      </div>
    </div>
    <div class="actions">
      <div class="judge">
        <button class="judge__btn" id="right" aria-label="I got it right — next card">✅</button>
        <button class="judge__btn" id="wrong" aria-label="I got it wrong — next card">🚫</button>
      </div>
    </div>`
  document.getElementById('right').addEventListener('click', () => choose('correct'))
  document.getElementById('wrong').addEventListener('click', () => choose('incorrect'))
}

restart()
