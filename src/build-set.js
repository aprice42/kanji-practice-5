/* The set builder — `npm run dev` only, at /build-set.html

   A practice set is a list of written forms in content/sets/. Writing one by
   hand means grepping content/words/ for the exact form, kana substitutions
   and all (こん立て, ひなんくん練), which is tedious for three words and
   error-prone for thirty. This is the same job with the words in front of you.

   It ships nothing. build-set.html is not a build entry point, and the endpoint
   it posts to lives in a Vite plugin marked `apply: 'serve'`.

   The page reads src/cards.js, which is GENERATED. So it shows the world as of
   the last `npm run cards` — a set saved here does not appear in its own list
   until that runs again, which is what the reminder after saving is for. */

import { cards, SETS } from './cards.js'
import './style.css'
import './build-set.css'

const PREFIX = 's:'
const root = document.getElementById('builder')

/* Sets that define cards, for filtering the grid. A practice set is not a
   filter — you build one from the curriculum, not from another practice set. */
const SOURCE_SETS = SETS.filter((s) => !s.id.startsWith(PREFIX))

/* Practice sets that already exist, with their members, so one can be opened
   and edited rather than rebuilt from memory. */
const existingSets = SETS.filter((s) => s.id.startsWith(PREFIX)).map((s) => ({
  ...s,
  slug: s.id.slice(PREFIX.length),
  forms: cards.filter((c) => c.sets.includes(s.id)).map((c) => c.written),
}))

const state = {
  picked: new Set(),
  filter: 'all',
  query: '',
  name: '',
  editing: null, // slug of the set being edited, if any
  status: { text: '', tone: '' },
}

const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/* Emitted in pool order rather than click order, so the file is stable: two
   people picking the same words get the same diff. */
const pickedInOrder = () => cards.filter((c) => state.picked.has(c.written))

function markdown() {
  const forms = pickedInOrder().map((c) => c.written)
  return `# ${state.name.trim() || 'Untitled set'}\n\n${forms.map((f) => `- ${f}`).join('\n')}\n`
}

function matches(card) {
  if (state.filter !== 'all' && !card.sets.includes(state.filter)) return false
  const q = state.query.trim().toLowerCase()
  if (!q) return true
  return (
    card.written.includes(q) ||
    card.reading.includes(q) ||
    card.meaning.toLowerCase().includes(q)
  )
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function tile(card) {
  const on = state.picked.has(card.written)
  return `
    <button class="b-tile" type="button" aria-pressed="${on}" data-form="${esc(card.written)}">
      <span class="b-tile__w" lang="ja">${esc(card.written)}</span>
      <span class="b-tile__r" lang="ja">${esc(card.reading)}</span>
    </button>`
}

function render() {
  const shown = cards.filter(matches)
  const slug = slugify(state.name)
  const renaming = state.editing && slug && slug !== state.editing

  root.innerHTML = `
    <div class="b-wrap">
      <header class="b-head">
        <h1>Set builder</h1>
        <p>
          Pick words, name the set, save it. Writes <code>content/sets/&lt;name&gt;.md</code>.
          Development only — this page is not part of the built app.
        </p>
      </header>

      <div class="b-bar">
        <div class="b-field">
          <label for="set-name">Set name</label>
          <input type="text" id="set-name" value="${esc(state.name)}" placeholder="Week 3 test"
                 autocomplete="off" />
        </div>
        <div class="b-field">
          <label for="set-search">Search reading, form or meaning</label>
          <input type="search" id="set-search" value="${esc(state.query)}" placeholder="つ / 学 / school"
                 autocomplete="off" />
        </div>
        <div class="b-field" style="flex:1;min-width:16rem">
          <label id="filter-label">Show</label>
          <div class="b-filters" role="group" aria-labelledby="filter-label">
            <button class="b-pill" type="button" data-filter="all"
                    aria-pressed="${state.filter === 'all'}">All ${cards.length}</button>
            ${SOURCE_SETS.map(
              (s) => `<button class="b-pill" type="button" data-filter="${esc(s.id)}"
                        aria-pressed="${state.filter === s.id}">${esc(s.label)} ${s.cards}</button>`
            ).join('')}
          </div>
        </div>
      </div>

      ${
        existingSets.length
          ? `<div class="b-existing">
               <span>Open an existing set:</span>
               ${existingSets
                 .map(
                   (s) => `<button class="b-pill" type="button" data-open="${esc(s.slug)}"
                             aria-pressed="${state.editing === s.slug}">${esc(s.label)} ${s.forms.length}</button>`
                 )
                 .join('')}
             </div>`
          : ''
      }

      ${
        shown.length
          ? `<div class="b-grid">${shown.map(tile).join('')}</div>`
          : `<p class="b-empty">Nothing matches.</p>`
      }

      <pre class="b-out" aria-label="The file that will be written">${esc(
        state.picked.size ? markdown() : 'Pick some words to see the file.'
      )}</pre>
    </div>

    <div class="b-foot">
      <div class="b-foot__inner">
        <span class="b-count">${state.picked.size} picked${
          shown.length !== cards.length ? ` · ${shown.length} shown` : ''
        }</span>
        <span class="b-status ${state.status.tone}" role="status" aria-live="polite">${esc(
          renaming
            ? `Saving will rename ${state.editing}.md to ${slug}.md`
            : state.status.text
        )}</span>
        <span class="b-spacer"></span>
        ${
          state.editing
            ? `<button class="b-btn b-btn--danger" type="button" id="delete">Delete this set</button>`
            : ''
        }
        <button class="b-btn b-btn--ghost" type="button" id="clear"
                ${state.picked.size ? '' : 'disabled'}>Clear</button>
        <button class="b-btn" type="button" id="save"
                ${state.picked.size && slug ? '' : 'disabled'}>Save</button>
      </div>
    </div>`

  bind()
}

/* Re-rendering on every keystroke would drop the caret, so the two text inputs
   update state and re-render only what depends on them. */
function bind() {
  const name = document.getElementById('set-name')
  name.addEventListener('input', () => {
    state.name = name.value
    state.status = { text: '', tone: '' }
    refreshFoot()
    refreshOut()
  })

  const search = document.getElementById('set-search')
  search.addEventListener('input', () => {
    state.query = search.value
    const at = search.selectionStart
    render()
    const next = document.getElementById('set-search')
    next.focus()
    next.setSelectionRange(at, at)
  })

  for (const btn of document.querySelectorAll('[data-filter]')) {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter
      render()
    })
  }

  for (const btn of document.querySelectorAll('[data-open]')) {
    btn.addEventListener('click', () => open(btn.dataset.open))
  }

  for (const btn of document.querySelectorAll('[data-form]')) {
    btn.addEventListener('click', () => {
      const form = btn.dataset.form
      if (state.picked.has(form)) state.picked.delete(form)
      else state.picked.add(form)
      btn.setAttribute('aria-pressed', String(state.picked.has(form)))
      state.status = { text: '', tone: '' }
      refreshFoot()
      refreshOut()
    })
  }

  document.getElementById('clear')?.addEventListener('click', () => {
    state.picked.clear()
    state.editing = null
    state.status = { text: '', tone: '' }
    render()
  })

  document.getElementById('save')?.addEventListener('click', save)
  document.getElementById('delete')?.addEventListener('click', remove)
}

function refreshOut() {
  const out = document.querySelector('.b-out')
  if (out) out.textContent = state.picked.size ? markdown() : 'Pick some words to see the file.'
}

function refreshFoot() {
  const slug = slugify(state.name)
  const count = document.querySelector('.b-count')
  const shown = cards.filter(matches).length
  if (count) {
    count.textContent =
      `${state.picked.size} picked` + (shown !== cards.length ? ` · ${shown} shown` : '')
  }
  const status = document.querySelector('.b-status')
  if (status) {
    const renaming = state.editing && slug && slug !== state.editing
    status.className = `b-status ${renaming ? '' : state.status.tone}`
    status.textContent = renaming
      ? `Saving will rename ${state.editing}.md to ${slug}.md`
      : state.status.text
  }
  const save = document.getElementById('save')
  if (save) save.disabled = !(state.picked.size && slug)
  const clear = document.getElementById('clear')
  if (clear) clear.disabled = !state.picked.size
}

function open(slug) {
  const set = existingSets.find((s) => s.slug === slug)
  if (!set) return
  state.editing = slug
  state.name = set.label
  state.picked = new Set(set.forms)
  state.status = { text: `Editing ${slug}.md`, tone: '' }
  render()
}

async function post(payload) {
  const res = await fetch('/__sets/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.json()
}

async function save() {
  const slug = slugify(state.name)
  try {
    /* A rename writes the new file and removes the old one, so editing a set
       and changing its name does not quietly leave two. */
    if (state.editing && state.editing !== slug) {
      await post({ slug: state.editing, remove: true })
    }
    const result = await post({ slug, markdown: markdown() })
    if (!result.ok) throw new Error(result.error)
    state.editing = slug
    state.status = {
      text: `Wrote ${result.path} — now run \`npm run cards && npm run check\``,
      tone: 'is-good',
    }
  } catch (error) {
    state.status = { text: `Could not write it: ${error.message}`, tone: 'is-bad' }
  }
  render()
}

async function remove() {
  const slug = state.editing
  if (!slug) return
  /* Two presses rather than a confirm dialog: this page has no modal, and a
     browser confirm() is exactly the kind of thing that gets clicked through. */
  const btn = document.getElementById('delete')
  if (btn.dataset.armed !== 'yes') {
    btn.dataset.armed = 'yes'
    btn.textContent = 'Press again to delete'
    return
  }
  try {
    const result = await post({ slug, remove: true })
    if (!result.ok) throw new Error(result.error)
    state.picked.clear()
    state.editing = null
    state.name = ''
    state.status = {
      text: `Deleted ${result.path} — now run \`npm run cards && npm run check\``,
      tone: 'is-good',
    }
  } catch (error) {
    state.status = { text: `Could not delete it: ${error.message}`, tone: 'is-bad' }
  }
  render()
}

render()
