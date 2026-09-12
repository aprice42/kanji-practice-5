import { cards as rawCards } from './cards.js'
import './style.css'

// Stable id per card so a card's status survives across practice rounds.
const cards = rawCards.map((card, id) => ({ ...card, id }))

const app = document.getElementById('app')

const state = {
  // id -> 'correct' | 'incorrect'. The source of truth for the score: a card
  // answered wrong in round 1 and right in round 2 simply flips to 'correct'.
  status: new Map(),
  deck: [],
  index: 0,
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

function byStatus(kind) {
  return cards.filter((card) => state.status.get(card.id) === kind)
}

function startRound(deck) {
  state.deck = shuffle(deck)
  state.index = 0
  state.revealed = false
  state.done = false
  render()
}

function restart() {
  state.status.clear()
  startRound(cards)
}

function practiceMissed() {
  startRound(byStatus('incorrect'))
}

function choose(kind) {
  state.status.set(state.deck[state.index].id, kind)
  state.revealed = false
  if (state.index + 1 >= state.deck.length) state.done = true
  else state.index++
  render()
}

function tally() {
  const correct = byStatus('correct').length
  const incorrect = byStatus('incorrect').length
  return `
    <div class="tally" role="status" aria-live="polite">
      <span class="tally__group">
        <span class="tally__icon" aria-hidden="true">✅</span>
        <span class="tally__count">${correct}</span>
        <span class="visually-hidden">correct</span>
      </span>
      <span class="tally__group">
        <span class="tally__count">${incorrect}</span>
        <span class="tally__icon" aria-hidden="true">🚫</span>
        <span class="visually-hidden">incorrect</span>
      </span>
    </div>`
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

function table(caption, list) {
  if (!list.length) return ''
  return `
    <table class="results__table">
      <caption>${caption}</caption>
      <thead>
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
    ${tally()}
    <div class="results">
      <p class="results__score">${correct.length} / ${cards.length}</p>
      <p class="results__label">
        ${missed.length ? `${missed.length} still to get` : 'All correct — nice work! 🎉'}
      </p>
      <div class="results__tables">
        ${table(`🚫 Missed (${missed.length})`, missed)}
        ${table(`✅ Correct (${correct.length})`, correct)}
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

  if (missed.length) {
    document.getElementById('retry').addEventListener('click', practiceMissed)
  }
  document.getElementById('restart').addEventListener('click', restart)
}

function render() {
  if (state.done) return renderResults()

  const card = state.deck[state.index]

  if (!state.revealed) {
    app.innerHTML = `
      ${tally()}
      ${progress()}
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
    ${progress()}
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
