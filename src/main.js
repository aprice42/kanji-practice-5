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

/* Below this, a selection is one round and the question is not worth asking —
   a checkpoint after twenty of twenty-six cards is an interruption rather than
   a kindness. */
const ASK_ABOVE = 40
const ROUND_SIZES = [10, 20, 30]

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
const SECTION_ORDER = ['Curriculum', 'Worksheets', 'Kana', 'My sets']
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
  flashcards: { label: 'Flash cards', icon: 'cards', hint: 'Show the answer, then mark yourself', directional: true },
  choice: { label: 'Multiple choice', icon: 'choice', hint: 'Pick the right answer from three', directional: true },
  /* Trace always shows the reading and always draws the written form — there is
     no other way round for it, which is why direction was never on the home
     screen. */
  trace: { label: 'Trace', icon: 'brush', hint: 'Draw the written form, stroke by stroke', directional: false },
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
  again:
    '<path d="M39 24a15 15 0 1 1-4.4-10.6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>' +
    '<path d="M39 7v11H28" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>',
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
  /* 'home' | 'sets' | 'manage' | 'format' | 'settings' | 'practice' |
     'results' | 'builder' | 'share' | 'receive'. The three flow panes are
     screens like any other: choosing what to practice is not a dialog. */
  screen: 'home',
  mode: 'flashcards', // 'flashcards' | 'choice'
  direction: 'reading-first',
  /* How the last session was paced. These used to be module-level bindings
     that survived navigation and nothing else; they are settings like any
     other now, and they are remembered — see PREFS_KEY. */
  paceMode: 'rounds', // 'rounds' | 'all'
  paceSize: 20,
  /* True once a session has actually been started, which is what lets Home
     offer to repeat it. Not the same as "has a selection": someone can tick a
     set and walk away without ever choosing a mode. */
  hasLast: false,
  /* The session available to pick up, validated and ready to rehydrate, or
     null. Set at boot and kept in step by persistSession, so Home has one
     thing to look at rather than reaching into storage on every render. */
  resume: null,
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
  /* Naming the missed words, on the results screen. null when not naming. */
  keeping: null,
  /* A pass through the selection, dealt out in rounds. null when a round is
     just a round. */
  session: null,
  /* The mode waiting on an answer to "how do you want to do this?" */
  pendingMode: null,
  // Which set, if any, is showing its inline "really?" in the library.
  confirmDelete: null,
}

/* Theme ------------------------------------------------------------------ */

const THEME_KEY = 'kanji-practice:theme'
const PALETTE_KEY = 'kanji-practice:palette'
const SELECTION_KEY = 'kanji-practice:selection'
const USER_SETS_KEY = 'kanji-practice:sets'
/* How the last session was set up. Written when a session actually starts, not
   when a radio is tapped: this describes what someone practiced, not what they
   were considering on the way there. */
const PREFS_KEY = 'kanji-practice:prefs'
/* A session in progress, so being interrupted does not cost the round. */
const SESSION_KEY = 'kanji-practice:session'

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

    /* Validated field by field rather than spread in. A mode that no longer
       exists, or a round size that is no longer offered, would otherwise sit
       in state describing a session the app cannot deal. */
    const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')
    if (prefs && typeof prefs === 'object') {
      if (MODES[prefs.mode]) state.mode = prefs.mode
      if (DIRECTIONS.some((d) => d.id === prefs.direction)) state.direction = prefs.direction
      if (prefs.paceMode === 'rounds' || prefs.paceMode === 'all') state.paceMode = prefs.paceMode
      if (ROUND_SIZES.includes(prefs.paceSize)) state.paceSize = prefs.paceSize
      /* Only worth offering to repeat if there is still something to repeat it
         with — every set may have been deleted since. */
      state.hasLast = Boolean(MODES[prefs.mode]) && state.selection.size > 0
    }
  } catch {
    // Private browsing or blocked storage — stay on the defaults.
  }
  applyTheme()

  /* Nothing stored, or nothing in it still resolves: this person has never
     chosen, and there is no special mode for that any more. Home offers Get
     started, and step one's Next stays disabled until something is ticked. */
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
    /* Unticking the last one is allowed: step one is where everyone starts
       with nothing, and Next is disabled instead. Refusing to untick something
       a moment after ticking it would be nonsense. */
    if (!state.selection.size) return false
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

/* Chips, not a sentence. describeSelection() gives up at three and says
   "3 sets", which is precisely the point a child stops being able to hold the
   answer in their head — and three is one grade plus both kana, an ordinary
   choice rather than an edge case.

   `max` is how many names are shown before the rest become a counter. The
   counter is honest about hiding something; the old string was not. */
/* Every name, joined. "3 sets" is no use to someone trying to work out what
   they are in the middle of; the CSS truncates with an ellipsis and the title
   attribute carries the whole thing. */
const selectionNames = () => selectedSets().map((s) => s.label).join(' \u00b7 ')

/* Two names, then a counter. Two is what fits on one line at 360px. */
const SUMMARY_CHIPS = 2
const selectionSummary = () =>
  state.selection.size ? selectionChips(SUMMARY_CHIPS) : escapeHtml(describeSelection())

function selectionChips(max = Infinity) {
  const chosen = selectedSets()
  if (!chosen.length) return ''
  const shown = chosen.slice(0, max)
  const hidden = chosen.length - shown.length
  return `
    <span class="chiplist">
      ${shown.map((s) => `<span class="selchip">${escapeHtml(s.label)}</span>`).join('')}
      ${hidden ? `<span class="selchip selchip--more">+${hidden} more</span>` : ''}
    </span>`
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
  state.keeping = null
  state.round = shuffle(list)
  state.index = 0
  state.screen = 'practice'
  prepareCard()
  render()
}

/* How a pass through the selection is cut up.

   Fixed-size rounds, except that a tail shorter than half a round is folded
   into the one before it rather than left standing alone — "Round 12 of 12 ·
   1 card" is a checkpoint for nothing. */
function roundPlan(total, size) {
  if (!size || total <= size) return [total]
  const plan = Array(Math.floor(total / size)).fill(size)
  const tail = total % size
  if (tail === 0) return plan
  if (tail < size / 2) plan[plan.length - 1] += tail
  else plan.push(tail)
  return plan
}

/* A session is one pass through the selection, SHUFFLED ONCE and dealt out in
   order. That is the whole difference from the round cap that was tried and
   removed: a few short rounds cover the selection exactly once, where a cap
   re-sampled it at random every round and never guaranteed a card was seen. */
function startSession(size) {
  const cards = activeCards()
  state.status.clear()
  state.session = {
    order: shuffle(cards),
    plan: roundPlan(cards.length, size),
    roundIndex: 0,
    dealt: 0,
    total: cards.length,
    firstTry: new Map(),
  }
  dealRound()
}

function dealRound() {
  const s = state.session
  const size = s.plan[s.roundIndex]
  const slice = s.order.slice(s.dealt, s.dealt + size)
  s.dealt += size
  startRound(slice)
}

function nextRound() {
  state.session.roundIndex++
  dealRound()
}

/* How this sitting is going to work: which way round, and how long a round is.

   Both belong to the sitting rather than to the selection — how much time
   someone has tonight is not a stable answer, and neither is whether they feel
   like reading or recalling — so both are asked every time rather than
   remembered.

   The screen appears when there is something to ask: a direction, if the mode
   has one, or a round size, if the selection is long enough for it to matter.
   Trace on a short set has neither, and starts straight away. */
const needsSetup = (mode) => MODES[mode].directional || activeCards().length > ASK_ABOVE

/* The end of the flow: everything has been answered, so deal the cards. */
function beginSession() {
  if (!state.selection.size) {
    state.screen = 'sets'
    render()
    return
  }
  state.mode = state.pendingMode ?? state.mode
  state.keeping = null
  if (!needsSetup(state.mode)) {
    state.session = null
    state.status.clear()
    startRound(activeCards())
    return
  }
  const long = activeCards().length > ASK_ABOVE
  savePrefs()
  startSession(long && state.paceMode === 'rounds' ? state.paceSize : null)
}

/* Swallows its own failure, like saveSelection: a blocked storage should cost
   someone the shortcut, not the round they were about to start. */
function savePrefs() {
  state.hasLast = true
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        mode: state.mode,
        direction: state.direction,
        paceMode: state.paceMode,
        paceSize: state.paceSize,
      })
    )
  } catch {
    // Private browsing or a full quota. Nothing to do about it here.
  }
}

/* What Home offers to repeat. Named in full, because "Practice again" alone
   asks someone to remember what they did last time — which is the thing they
   opened the app instead of doing. */
function lastSessionLine() {
  const bits = [describeSelection(), MODES[state.mode].label]
  if (activeCards().length > ASK_ABOVE) {
    bits.push(state.paceMode === 'rounds' ? `rounds of ${state.paceSize}` : 'all at once')
  }
  return bits.join(' \u00b7 ')
}

/* Reached from the nav menu mid-round: the answer is to set the session up
   again rather than swap the mode underneath a live card. */
function askPace(mode) {
  if (!state.selection.size) return
  state.pendingMode = mode
  state.screen = 'format'
  render()
}

/* Picking up where you left off ------------------------------------------
   A child gets called to dinner seven cards into a round of twenty. Before
   this, that round was gone.

   Everything is stored as WRITTEN FORMS and rehydrated through cardByForm:
   state.round and session.order hold card objects, which do not survive
   JSON in any useful way.

   The invariant that makes this work: `round` is authoritative and `session`
   is bookkeeping — the progress line and the "is there another round" test.
   Nothing may rebuild `round` from `order.slice(dealt - size, dealt)`, which
   is why a retry round, which is not a slice of anything, resumes for free.
   ------------------------------------------------------------------------- */

/* Called at the end of render(), not from each mutator. A pure function of
   state cannot be forgotten by the next person to add a fourth way of changing
   the round, and running it after app.innerHTML keeps setItem off the path
   between a tap and the paint that answers it. */
function persistSession() {
  /* Only the two screens that HAVE a position write one. On home, or anywhere
     in the flow, the blob on disk is left exactly as it is — which is what
     preserves a checkpoint someone walked away from. */
  if (state.screen !== 'practice' && state.screen !== 'results') return

  const finished = state.screen === 'results' && !hasMoreRounds()
  if (finished || !state.round.length) {
    /* Finishing the last round ends the session. Retrying the misses
       afterwards is extra work, not an unfinished session — without this,
       someone who never taps Retry is offered a resume into a dead end
       forever. */
    forgetSession()
    return
  }

  const blob = {
    v: 1,
    saved: Date.now(),
    screen: state.screen,
    mode: state.mode,
    direction: state.direction,
    selection: [...state.selection],
    round: state.round.map((card) => card.written),
    index: state.index,
    status: [...state.status],
    session: state.session && {
      order: state.session.order.map((card) => card.written),
      plan: state.session.plan,
      roundIndex: state.session.roundIndex,
      dealt: state.session.dealt,
      total: state.session.total,
      firstTry: [...state.session.firstTry],
    },
  }

  state.resume = blob
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(blob))
  } catch {
    /* Blocked storage or a full quota. Losing the resume is the whole cost;
       an uncaught throw in here would take the screen down mid-answer, which
       is not. */
  }
}

function forgetSession() {
  state.resume = null
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to do about it.
  }
}

const isJudgement = (pair) =>
  Array.isArray(pair) &&
  pair.length === 2 &&
  typeof pair[0] === 'string' &&
  (pair[1] === 'correct' || pair[1] === 'incorrect')

/* Validated rather than trusted, and more strictly than anything else here:
   a half-restored session would practice fewer cards than its plan says and
   corrupt the dealt/roundIndex arithmetic on the way. If any one thing is
   wrong the whole blob goes, the same rule share links already follow. */
function validSession(b) {
  if (!b || typeof b !== 'object' || b.v !== 1) return null
  if (!MODES[b.mode]) return null
  /* Direction is meaningless for trace, so a trace session is not thrown away
     over a field it never reads. */
  if (MODES[b.mode].directional && !DIRECTIONS.some((d) => d.id === b.direction)) return null
  if (b.screen !== 'practice' && b.screen !== 'results') return null
  if (!Array.isArray(b.selection)) return null
  if (!Array.isArray(b.round) || !b.round.length) return null
  if (!b.round.every((form) => cardByForm.has(form))) return null
  if (!Number.isInteger(b.index) || b.index < 0 || b.index >= b.round.length) return null
  if (!Array.isArray(b.status) || !b.status.every(isJudgement)) return null

  /* A session with no plan is legal: trace, or a selection small enough that
     nothing was asked about pace. */
  if (b.session != null) {
    const s = b.session
    if (typeof s !== 'object') return null
    if (!Array.isArray(s.order) || !s.order.length) return null
    if (!s.order.every((form) => cardByForm.has(form))) return null
    if (!Array.isArray(s.plan) || !s.plan.length) return null
    if (!s.plan.every((n) => Number.isInteger(n) && n > 0)) return null
    if (!Number.isInteger(s.total) || s.total !== s.order.length) return null
    // A plan that disagrees with the total would draw a progress bar wider
    // than its own track.
    if (s.plan.reduce((a, n) => a + n, 0) !== s.total) return null
    if (!Number.isInteger(s.roundIndex) || s.roundIndex < 0 || s.roundIndex >= s.plan.length) return null
    if (!Number.isInteger(s.dealt) || s.dealt < 0 || s.dealt > s.total) return null
    if (!Array.isArray(s.firstTry) || !s.firstTry.every(isJudgement)) return null
  }
  /* Deliberately NOT checked: that round is a slice of order, or that its
     length matches plan[roundIndex]. A retry round is neither. */
  return b
}

function loadSession() {
  try {
    state.resume = validSession(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'))
  } catch {
    // Not even JSON — a truncated write, or something else's key.
    state.resume = null
  }
  // Swept up either way, so a blob that can never be resumed does not sit
  // there being re-parsed and re-rejected on every launch.
  if (!state.resume) forgetSession()
}

/* Straight into state \u2014 never through startRound(), which reshuffles and
   resets the index, leaving the stored position pointing into a different
   order: answered cards would replay and unanswered ones be skipped. For the
   same reason dealRound() is never replayed; it advances `dealt` at deal time,
   before the round is played. */
function resumeSession() {
  const b = state.resume
  if (!b) return
  state.mode = b.mode
  if (MODES[b.mode].directional) state.direction = b.direction
  /* In memory only, and never written back to the selection: picking a session
     up should not rewrite a picker they have changed since. */
  state.selection = new Set(
    b.selection.map(migrateSetId).filter((id) => playableSets().some((set) => set.id === id))
  )
  state.round = b.round.map((form) => cardByForm.get(form))
  state.index = b.index
  state.status = new Map(b.status)
  state.session = b.session
    ? {
        order: b.session.order.map((form) => cardByForm.get(form)),
        plan: [...b.session.plan],
        roundIndex: b.session.roundIndex,
        dealt: b.session.dealt,
        total: b.session.total,
        firstTry: new Map(b.session.firstTry),
      }
    : null
  state.keeping = null
  state.screen = b.screen
  prepareCard()
  render()
}

/* Roughly when, because "Round 2 of 3" alone does not tell a child whether
   this is the thing they were doing ten minutes ago or last Tuesday. */
function whenWord(ms) {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (mins < 5) return 'just now'
  if (mins < 60) return `${mins} minutes ago`
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  if (ms >= midnight.getTime()) return 'earlier today'
  if (ms >= midnight.getTime() - 86400000) return 'yesterday'
  return 'a while back'
}

function resumeLine(b) {
  const bits = []
  if (b.session) bits.push(`Round ${b.session.roundIndex + 1} of ${b.session.plan.length}`)
  bits.push(b.screen === 'results' ? 'at the break' : `card ${b.index + 1} of ${b.round.length}`)
  bits.push(whenWord(b.saved))
  return bits.join(' \u00b7 ')
}

const hasMoreRounds = () =>
  Boolean(state.session) && state.session.roundIndex + 1 < state.session.plan.length

function restart() {
  state.status.clear()
  state.session = null
  /* A resumed session can outlive every set it was built from. Sending them to
     step one beats a button that silently does nothing. */
  if (!state.selection.size) {
    state.screen = 'sets'
    render()
    return
  }
  askPace(state.mode)
}

function practiceMissed() {
  // Not a round of the session: it does not advance `roundIndex`, so the
  // checkpoint after it is the same one, still offering the next round.
  startRound(byStatus('incorrect'))
}

function goHome() {
  state.screen = 'home'
  state.confirmDelete = null
  render()
}

function setMode(mode) {
  // Unreachable through the UI — the picker is in the way until something is
  // chosen — but a round of nothing is not a state to leave possible.
  if (!state.selection.size) return
  if (state.mode === mode && state.screen === 'practice') return
  askPace(mode)
}

function score(kind) {
  const id = state.round[state.index].id
  /* Recorded once and never overwritten. The dial says where they have got to;
     the first-try number is the honest one, and a retry must not quietly turn
     a miss into a win. */
  if (state.session && !state.session.firstTry.has(id)) state.session.firstTry.set(id, kind)
  state.status.set(id, kind)
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

/* The rows of the flow ----------------------------------------------------
   Step one lists every set; the manage detour lists the ones this person made.
   Both used to live in a modal; they are panes now.
   ------------------------------------------------------------------------- */

const BOX = { true: 'boxCheck', false: 'box' }

function setRow(set) {
  const ready = isPlayable(set)
  const checked = String(state.selection.has(set.id))
  const check = `
    <button class="setrow" role="checkbox" aria-checked="${checked}"
            ${ready ? '' : 'disabled'} data-set="${set.id}">
      <span class="setrow__box">${icon(BOX[checked], 'icon--box')}</span>
      <span class="setrow__label">${escapeHtml(set.label)}</span>
      <span class="setrow__count ${ready ? '' : 'is-muted'}">${ready ? set.cards : 'not ready'}</span>
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
  const on = state.selection.has(set.id)
  return `
    <div class="libcard ${on ? 'libcard--on' : ''}">
      <span class="libcard__name">
        ${escapeHtml(set.label)}
        <small>${set.cards} word${set.cards === 1 ? '' : 's'}</small>
      </span>
      ${on && !confirming ? `<span class="libcard__tag">Practicing</span>` : ''}
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

/* What is chosen, above the rows that change it. The pane holds nine rows and
   a phone shows about six, so the moment a child scrolls to the kana their
   choices leave the screen.

   The chips are spans, not buttons. Tapping one to remove it is the obvious
   gesture and also a destructive tap sitting directly on a scroll surface —
   the rows below are where you change your mind. */
function selectionTray() {
  const chosen = selectedSets()
  const cards = activeCards().length
  return `
    <div class="tray">
      <p class="tray__head">
        <span>Practicing</span>
        <span class="tray__count">${
          chosen.length ? `${chosen.length} set${chosen.length === 1 ? '' : 's'} \u00b7 ${cards} cards` : ''
        }</span>
      </p>
      ${
        chosen.length
          ? selectionChips()
          : `<p class="tray__empty">Nothing picked yet \u2014 tap a list below.</p>`
      }
    </div>`
}

/* The rows of step one, grouped by where each set came from. */
function setList() {
  return sections()
    .map(
      (section) => `
        <p class="menu__heading">${escapeHtml(section)}</p>
        ${setsIn(section).map(setRow).join('')}`
    )
    .join('')
}

/* The rows of the manage detour: the sets this person made, and a way to make
   another. Nothing that edits or deletes belongs on a step-one row \u2014 that is
   the row they tap every day. */
function libraryList() {
  return `
    ${
      state.userSets.length
        ? state.userSets.map(libraryCard).join('')
        : `<p class="pane__empty">
             Nothing here yet. A set is any words you want to practice together \u2014
             the ones on this week's test, or the ones you keep getting wrong.
           </p>`
    }
    <button class="libnew" id="new-set">
      ${icon('plus', 'icon--act')}
      <span><b>New set</b><small>Pick words and give it a name</small></span>
    </button>`
}

/* Swap the rows in place. Re-rendering the whole pane would restart its entry
   animation and reset the scroll position, which reads as a flash on a screen
   whose whole job is a list you are working down. */
function refreshLibrary() {
  const body = app.querySelector('.pane__body')
  if (!body) return
  body.innerHTML = libraryList()
  bindLibrary()
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
  state.screen = 'manage'
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
      .share({ title: set.label, text: `${set.label} — Japanese Kanji Practice`, url: state.share.url })
      .catch(() => {
        /* Cancelling rejects, and so does a failure. Either way nothing was
           sent, and the screen should not claim otherwise. */
      })
  })

  bindMenus()
}

/* What a checkpoint says about the session it sits inside. "Round 2 of 11" is
   a promise that this ends; without it a checkpoint is an interruption that
   keeps happening. The first-try figure sits here too — the dial is where they
   have got to, and this is the honest number a retry cannot move. */
function sessionLine() {
  const s = state.session
  if (!s) return ''
  const first = [...s.firstTry.values()].filter((k) => k === 'correct').length
  const tried = s.firstTry.size
  return `
    <div class="session">
      <div class="session__track">
        <div class="session__fill" style="width: ${(s.dealt / s.total) * 100}%"></div>
      </div>
      <p class="session__row">
        <span>Round ${s.roundIndex + 1} of ${s.plan.length}</span>
        <span>${s.dealt} of ${s.total} cards</span>
      </p>
      ${tried ? `<p class="session__first">First try ${first} of ${tried}</p>` : ''}
    </div>`
}

/* How do you want to do this? ---------------------------------------------
   Asked after the words are chosen and before the first card, because that is
   the moment the number means anything — "226 cards" reads very differently
   from "Grade 5", and "eleven rounds" is a shape a size control alone never
   shows you.
   ------------------------------------------------------------------------- */

function renderSettings() {
  const mode = state.pendingMode ?? state.mode
  const total = activeCards().length
  const plan = roundPlan(total, state.paceSize)
  const rounds = state.paceMode === 'rounds'
  const long = total > ASK_ABOVE
  const kind = selectionIsKana() ? 'kana' : 'word'

  app.innerHTML = `
    ${appHeader(false)}
    ${stepRail('settings')}
    <div class="pane">
      ${summaryPill(true)}
      <div class="pane__body pane__body--center">
        ${
          MODES[mode].directional
            ? `<div class="pace__group">
                 <p class="pace__label" id="pace-direction-label">Which way round</p>
                 <div class="mode" role="radiogroup" aria-labelledby="pace-direction-label">
                   ${DIRECTIONS.map(
                     (d) => `<button class="mode__btn ${state.direction === d.id ? 'is-active' : ''}"
                               type="button" role="radio" aria-checked="${state.direction === d.id}"
                               data-direction="${d.id}" title="${d.hint}">${d[kind]}</button>`
                   ).join('')}
                 </div>
               </div>`
            : ''
        }

        ${
          long
            ? `<div class="pace__group">
                 <p class="pace__label" id="pace-length-label">How much at a time</p>
                 <div class="pace__choices" role="radiogroup" aria-labelledby="pace-length-label">
                   <button class="pick" type="button" role="radio" aria-checked="${rounds}" data-pace-mode="rounds">
                     <span class="pick__mark">${icon(rounds ? 'boxCheck' : 'box', 'icon--box')}</span>
                     <span class="pick__text">
                       <b>In rounds of ${state.paceSize}</b>
                       <small>${plan.length} round${plan.length === 1 ? '' : 's'}, with a break after each one</small>
                     </span>
                   </button>

                   ${
                     /* Only while it applies. An inert size control under an
                        unselected option is a thing to wonder about rather
                        than a thing to use. */
                     rounds
                       ? `<div class="seg" role="group" aria-label="How many cards in a round">
                            ${ROUND_SIZES.map(
                              (n) => `<button type="button" data-pace="${n}" aria-pressed="${state.paceSize === n}">${n}</button>`
                            ).join('')}
                          </div>`
                       : ''
                   }

                   <button class="pick" type="button" role="radio" aria-checked="${!rounds}" data-pace-mode="all">
                     <span class="pick__mark">${icon(rounds ? 'box' : 'boxCheck', 'icon--box')}</span>
                     <span class="pick__text">
                       <b>All ${total} at once</b>
                       <small>One long round, no breaks</small>
                     </span>
                   </button>
                 </div>
               </div>`
            : ''
        }
      </div>
    </div>
    ${paneFoot("Let's go!")}`

  const again = (attr, value) => {
    render()
    document.querySelector(`[${attr}="${value}"]`)?.focus()
  }
  for (const btn of app.querySelectorAll('[data-direction]')) {
    btn.addEventListener('click', () => {
      state.direction = btn.dataset.direction
      again('data-direction', state.direction)
    })
  }
  for (const btn of app.querySelectorAll('[data-pace-mode]')) {
    btn.addEventListener('click', () => {
      state.paceMode = btn.dataset.paceMode
      again('data-pace-mode', state.paceMode)
    })
  }
  for (const btn of app.querySelectorAll('[data-pace]')) {
    btn.addEventListener('click', () => {
      state.paceSize = Number(btn.dataset.pace)
      again('data-pace', state.paceSize)
    })
  }
  bindFlow({ next: beginSession, back: () => goScreen('format') })
}

/* Keeping the words from a round -----------------------------------------
   The results screen already knows which seven were wrong and already offers to
   practice them — as a round that evaporates. This keeps them.

   It is the moment the need actually arises. Nobody opens a set builder
   thinking "I should curate a word list"; they finish a round, miss the same
   seven again, and want those seven tomorrow.
   ------------------------------------------------------------------------- */

const defaultKeepName = () =>
  `Missed ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`

function keepMissed(missed) {
  const keeping = state.keeping
  const label = keeping.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  const forms = missed.map((card) => card.written).slice(0, MAX_FORMS)
  if (!label || !forms.length) return

  if (state.userSets.length >= MAX_SETS) {
    keeping.status = `That is ${MAX_SETS} sets, which is as many as this holds. Delete one first.`
    render()
    return
  }

  const set = {
    id: newSetId(),
    label,
    forms,
    section: 'My sets',
    kind: 'custom',
    created: Date.now(),
    cards: forms.length,
  }
  state.userSets.push(set)
  const failed = saveUserSets()
  if (failed) {
    state.userSets.pop()
    keeping.status = 'There is no room left to save this. Delete a set and try again.'
    render()
    return
  }

  rebuildMembership()
  /* Deliberately NOT selected. "Practice the N you missed" is the button for
     doing them now; this one is for having them tomorrow, and changing what
     they are practicing mid-results would be answering a question nobody
     asked. */
  state.keeping = { naming: false, name: '', status: `Saved to My sets as “${label}”.` }
  render()
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
  /* Step one, not Home: the set is already ticked, so they can see it landed
     and carry straight on into the flow. */
  state.incoming = null
  state.screen = 'sets'
  render()
}

/* Declining still has to leave them somewhere sensible. */
function dismissIncoming() {
  state.incoming = null
  /* Declining a shared set with nothing chosen leaves someone on a Home whose
     only button is Get started, which is the right place to be. */
  state.screen = 'home'
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
  state.screen = 'builder'
  render()
}

function closeBuilder() {
  state.builder = null
  // Back where the builder was opened from, which is always the manage pane.
  state.screen = 'manage'
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
    ${
      /* Title only. No home button, because Cancel and Save are the way out
         and a third exit that discards without saying so is a mis-tap; no
         gear, because nothing about this screen is a setting and it is the
         one piece of chrome that never applied here. */
      ''
    }
    <h1 class="pane__title">${b.id ? 'Edit this set' : 'Build a new set'}</h1>

    <div class="builder">
      <div class="builder__field">
        <label class="visually-hidden" for="set-name">Name</label>
        <input type="text" id="set-name" value="${escapeHtml(b.label)}" maxlength="${MAX_NAME}"
               placeholder="Week 3 test" autocomplete="off" />
      </div>

      <div class="builder__chosen">${chosenBlock()}</div>

      <div class="builder__find">
        <div class="builder__field">
          <label class="visually-hidden" for="set-search">Find words</label>
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

/* The running list of picked words, on its own so it can be swapped without
   touching the grid above it. */
function chosenBlock() {
  const b = state.builder
  const chosen = cards.filter((c) => b.forms.has(c.written))
  const full = b.forms.size >= MAX_FORMS
  return `
    <p class="builder__chosenhead">
      <span>Chosen</span>
      <span class="builder__count">${b.forms.size}${full ? ` \u00b7 full` : ''}</span>
    </p>
    ${
      chosen.length
        ? `<div class="chips">${chosen
            .map(
              (c) => `<button class="chip" type="button" data-drop="${escapeHtml(c.written)}">
                        <span${ja(c.written)}>${escapeHtml(c.written)}</span>
                        <span class="chip__x" aria-hidden="true">\u00d7</span>
                        <span class="visually-hidden">Remove</span>
                      </button>`
            )
            .join('')}</div>`
        : `<p class="builder__hint">Nothing chosen yet.</p>`
    }`
}

/* Picking a word must NOT re-render. The word grid scrolls, and rebuilding it
   sends someone who scrolled to 数学 back to 一本 on every tap — which makes
   choosing more than the first screenful of words impossible. Only the chosen
   list, the error line and the Save button depend on the pick, so only those
   are swapped. */
function syncChosen() {
  const b = state.builder
  const box = app.querySelector('.builder__chosen')
  if (!box) return
  box.innerHTML = chosenBlock()
  bindChips()

  const save = document.getElementById('save-set')
  if (save) save.disabled = !(b.label.trim() && b.forms.size)
  const error = app.querySelector('.builder__error')
  if (error) error.textContent = b.error
}

function bindChips() {
  for (const chip of app.querySelectorAll('[data-drop]')) {
    chip.addEventListener('click', () => {
      const form = chip.dataset.drop
      state.builder.forms.delete(form)
      // The grid may be showing this word; un-press it where it stands.
      for (const tile of app.querySelectorAll('[data-form]')) {
        if (tile.dataset.form === form) tile.setAttribute('aria-pressed', 'false')
      }
      state.builder.error = ''
      syncChosen()
    })
  }
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
        syncChosen()
        return
      } else b.forms.add(form)
      b.error = ''
      tile.setAttribute('aria-pressed', String(b.forms.has(form)))
      syncChosen()
    })
  }

  bindChips()

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
  state.confirmDelete = null
  /* Deleting the only thing selected sends them back to step one rather than
     leaving a manage pane whose Done button leads to a round of nothing. */
  if (!state.selection.size) {
    state.screen = 'sets'
    render()
    return
  }
  refreshLibrary()
}

/* Ticking a box updates the controls in place rather than re-rendering.

   Re-rendering was the obvious thing and it was wrong: render() replaces the
   pane wholesale, restarting its entry animation and resetting the scroll
   position of the very list being worked down. The theme and palette switches
   already avoid this for the same reason \u2014 see setTheme \u2014 so this follows them.

   Everything that can disagree is updated here: each box, the tray, and the
   Next button, which is disabled while nothing is chosen. */
function syncSets() {
  for (const btn of app.querySelectorAll('.pane [data-set]')) {
    const checked = String(state.selection.has(btn.dataset.set))
    btn.setAttribute('aria-checked', checked)
    btn.querySelector('.setrow__box').innerHTML = icon(BOX[checked], 'icon--box')
  }

  const tray = app.querySelector('.tray')
  if (tray) tray.outerHTML = selectionTray()

  const next = document.getElementById('flow-next')
  if (next) next.disabled = !state.selection.size
}

/* The controls inside the step-one list. Re-attached whenever the rows are
   replaced, which is the cost of not rebuilding the pane. */
function bindSetList() {
  const pane = app.querySelector('.pane')
  if (!pane) return
  const note = pane.querySelector('.pane__note')

  for (const btn of pane.querySelectorAll('[data-set]')) {
    btn.addEventListener('click', () => {
      const id = btn.dataset.set
      if (setSelected(id, !state.selection.has(id))) {
        note.textContent = ''
        syncSets()
      } else {
        note.textContent = 'Keep at least one selected \u2014 a round needs cards.'
      }
    })
  }
}

/* The controls inside the manage detour. */
function bindLibrary() {
  const pane = app.querySelector('.pane')
  if (!pane) return

  for (const btn of pane.querySelectorAll('[data-edit]')) {
    btn.addEventListener('click', () => openBuilder(btn.dataset.edit))
  }
  for (const btn of pane.querySelectorAll('[data-share]')) {
    btn.addEventListener('click', () => openShare(btn.dataset.share))
  }

  /* Two presses, not a confirm dialog: a browser confirm is the kind of thing
     that gets clicked through. */
  for (const btn of pane.querySelectorAll('[data-delete]')) {
    btn.addEventListener('click', () => {
      state.confirmDelete = btn.dataset.delete
      refreshLibrary()
      document.querySelector(`[data-reallydelete="${state.confirmDelete}"]`)?.focus()
    })
  }
  for (const btn of pane.querySelectorAll('[data-keepset]')) {
    btn.addEventListener('click', () => {
      state.confirmDelete = null
      refreshLibrary()
    })
  }
  for (const btn of pane.querySelectorAll('[data-reallydelete]')) {
    btn.addEventListener('click', () => deleteSet(btn.dataset.reallydelete))
  }

  pane.querySelector('#new-set')?.addEventListener('click', () => openBuilder(null))
}

/* Kana labels only when the whole selection is kana. A mixed selection is
   genuinely both, and the kanji labels are the ones that describe the harder
   half of it. */
const selectionIsKana = () => {
  const chosen = selectedSets()
  return chosen.length > 0 && chosen.every((s) => s.section === KANA_SECTION)
}

/* Direction used to live in the round, on a control above the card, and could
   be flipped mid-round — which rebuilt the multiple-choice options underneath
   the question being asked. It is set once before the first card now, on the
   setup screen, and holds for the whole session. */

function progress() {
  const total = state.round.length
  const position = state.index + 1
  return `
    <div class="progress">
      ${
        /* What you are in the middle of. Nothing on this screen said so, which
           leaves a child handed the tablet mid-session — or coming back after
           lunch — with no way to tell. Hidden from the accessibility tree
           because the screen is already announced on the way in and this would
           repeat it on every card. */
        `<span class="progress__who" aria-hidden="true" title="${escapeHtml(
          selectionNames()
        )}">${escapeHtml(selectionNames())}</span>`
      }
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
    ${progress()}`
}

function bindChrome() {
  bindMenus()
}

/* Screens ---------------------------------------------------------------- */

/* The header every pane wears. Full size on Home, where it is the point; a
   size down once the flow starts, where 140px of a 650px phone is the
   difference between seeing the last option and hunting for it. */
function appHeader(big) {
  return `
    <header class="apphead ${big ? 'apphead--big' : 'apphead--sm'}">
      <hgroup class="apphead__group">
        <h1 class="apphead__title" lang="ja">\u6f22\u5b57\u306e\u7df4\u7fd2</h1>
        ${
          /* Only at full size. Inside the flow it is the app's name repeated
             on every pane of something you are already in, and on a short
             phone it costs the settings pane its last unscrolled row. */
          big ? `<p class="apphead__tag">Japanese Kanji Practice</p>` : ''
        }
      </hgroup>
      ${settingsMenu()}
    </header>`
}

/* The steps this session actually has. Trace has no direction, and a small
   selection has no rounds to choose, so a short trace session is two steps and
   its Next reads Let's go!. One function so the rail and the button cannot
   disagree about how many there are. */
function flowSteps() {
  const mode = state.pendingMode ?? state.mode
  const steps = ['sets', 'format']
  if (MODES[mode]?.directional || activeCards().length > ASK_ABOVE) steps.push('settings')
  return steps
}

/* How much more of this. The question a child asks at step one, and the reason
   they give up when nothing answers it. */
function stepRail(screen) {
  const steps = flowSteps()
  const at = steps.indexOf(screen)
  if (at < 0) return ''
  return `
    <div class="rail" aria-hidden="true">
      ${steps.map((_, i) => `<span class="rail__seg ${i <= at ? 'is-done' : ''}"></span>`).join('')}
    </div>
    <p class="rail__txt">Step ${at + 1} of ${steps.length}</p>`
}

/* What has been chosen so far, carried forward. A button, not a caption:
   fixing a mistake is one touch rather than Back, Back, fix, Next, Next. */
function summaryPill(withMode) {
  const mode = state.pendingMode ?? state.mode
  const total = activeCards().length
  return `
    <button class="summary" type="button" data-goto="${withMode ? 'format' : 'sets'}">
      ${withMode ? `<span class="summary__ico">${icon(MODES[mode].icon, 'icon--act')}</span>` : ''}
      <span class="summary__text">
        <span class="summary__name">${withMode ? escapeHtml(MODES[mode].label) : selectionSummary()}</span>
        <span class="summary__count">${
          withMode ? `${escapeHtml(describeSelection())} \u00b7 ${total} cards` : `${total} cards`
        }</span>
      </span>
      <span class="summary__edit">Change</span>
    </button>`
}

/* Every pane's buttons, in the same order and the same place. Back is last
   because the harmless action belongs at the bottom — the same reason the
   round's checkpoint puts it there. */
function paneFoot(primary, { secondary = '', disabled = false } = {}) {
  return `
    <div class="actions pane__actions">
      <button class="btn" id="flow-next" ${disabled ? 'disabled' : ''}>${primary}</button>
      ${secondary ? `<button class="btn btn--secondary" id="flow-aside">${secondary}</button>` : ''}
      <button class="btn btn--quiet" id="flow-back">Back</button>
    </div>`
}

/* Shared by every pane: the pill jumps back, Back goes back, Next goes on. */
function bindFlow({ next, back }) {
  document.getElementById('flow-next')?.addEventListener('click', next)
  document.getElementById('flow-back')?.addEventListener('click', back)
  for (const btn of app.querySelectorAll('[data-goto]')) {
    btn.addEventListener('click', () => goScreen(btn.dataset.goto))
  }
  bindMenus()
}

function goScreen(screen) {
  state.screen = screen
  state.confirmDelete = null
  render()
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
      <div class="hero">
        <h1 class="hero__title" lang="ja">\u6f22\u5b57\u306e\u7df4\u7fd2</h1>
        <p class="hero__tag">Japanese Kanji Practice</p>
      </div>
      <div class="home__panel">
      ${
        isUpdateReady()
          ? `<div class="home__update" role="status">
               <p class="home__update-text">App update available</p>
               <button class="btn btn--update" id="update">Update</button>
             </div>`
          : ''
      }
      ${
        /* First, because it is the most time-sensitive thing on the screen:
           someone who walked away mid-round wants that round, not a new one. */
        state.resume
          ? `<button class="bigcard bigcard--go" id="resume">
               <span class="bigcard__glyph">${icon('again', 'icon--big')}</span>
               <span class="bigcard__text">
                 <b>Pick up where you left off</b>
                 <small>${escapeHtml(MODES[state.resume.mode].label)} \u00b7 ${escapeHtml(
                   resumeLine(state.resume)
                 )}</small>
               </span>
             </button>`
          : ''
      }
      ${
        /* One tap back to last night's homework. The flow is right for a first
           session and for changing what you study, and far too long for the
           fourth school night in a row. */
        state.hasLast
          ? `<button class="bigcard ${state.resume ? '' : 'bigcard--go'}" id="practice-again">
               <span class="bigcard__glyph">${icon('again', 'icon--big')}</span>
               <span class="bigcard__text">
                 <b>Practice again</b>
                 <small>${escapeHtml(lastSessionLine())}</small>
               </span>
             </button>`
          : ''
      }
      <button class="bigcard" id="get-started">
        <span class="bigcard__glyph" lang="ja">\u5b57</span>
        <span class="bigcard__text">
          <b>${state.hasLast ? 'Choose something else' : 'Get started'}</b>
          <small>${
            state.hasLast ? 'Pick different sets, or a different way' : 'Choose what you want to study'
          }</small>
        </span>
      </button>
      </div>
    </div>`

  document.getElementById('get-started').addEventListener('click', () => goScreen('sets'))
  document.getElementById('practice-again')?.addEventListener('click', beginSession)
  document.getElementById('resume')?.addEventListener('click', resumeSession)
  bindMenus()

  const update = document.getElementById('update')
  if (update) update.addEventListener('click', applyUpdate)

  // Every visit to the home screen is a chance to notice a new version.
  checkForUpdate()
}

function renderSets() {
  app.innerHTML = `
    ${appHeader(false)}
    ${stepRail('sets')}
    <div class="pane">
      <p class="pane__title">Select your practice sets</p>
      ${selectionTray()}
      <div class="pane__body">${setList()}</div>
      <p class="pane__note" role="status" aria-live="polite"></p>
    </div>
    ${paneFoot('Next', { secondary: 'Manage my sets', disabled: !state.selection.size })}`

  bindSetList()
  document.getElementById('flow-aside').addEventListener('click', () => goScreen('manage'))
  bindFlow({ next: () => goScreen('format'), back: goHome })
}

function renderManage() {
  app.innerHTML = `
    ${appHeader(false)}
    <div class="pane">
      <p class="pane__title">Manage your sets</p>
      <div class="pane__body">${libraryList()}</div>
      <p class="pane__note" role="status" aria-live="polite"></p>
    </div>
    ${paneFoot('Done')}`

  bindLibrary()
  /* Done, not Save: every edit in here has already written itself, and a Save
     button would imply that Back loses work. */
  bindFlow({ next: () => goScreen('sets'), back: () => goScreen('sets') })
}

function renderFormat() {
  const chosen = state.pendingMode ?? state.mode
  const last = flowSteps().at(-1) === 'format'

  app.innerHTML = `
    ${appHeader(false)}
    ${stepRail('format')}
    <div class="pane">
      <p class="pane__title">How do you want to practice?</p>
      ${summaryPill(false)}
      <div class="pane__body pane__body--center" role="radiogroup" aria-label="How do you want to practice?">
        ${Object.entries(MODES)
          .map(
            ([id, m]) => `
              <button class="card-btn" role="radio" aria-checked="${id === chosen}" data-mode="${id}">
                <span class="card-btn__icon">${icon(m.icon)}</span>
                <span class="card-btn__label">${m.label}</span>
                <span class="card-btn__hint">${m.hint}</span>
              </button>`
          )
          .join('')}
      </div>
    </div>
    ${paneFoot(last ? "Let's go!" : 'Next')}`

  /* Tapping picks; Next moves on. The mode cards used to start a round on the
     first tap, which left no room to change your mind and made this the one
     pane that behaved differently from the rest. */
  for (const btn of app.querySelectorAll('[data-mode]')) {
    btn.addEventListener('click', () => {
      state.pendingMode = btn.dataset.mode
      render()
      document.querySelector(`[data-mode="${state.pendingMode}"]`)?.focus()
    })
  }
  bindFlow({
    next: () => (last ? beginSession() : goScreen('settings')),
    back: () => goScreen('sets'),
  })
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
  /* Whether there is more of the session to come. A retry does not advance the
     session, so the checkpoint after one still offers the next round — without
     that, retrying your misses stranded you at the end of a session you were
     eleven rounds from finishing. */
  const more = hasMoreRounds()
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
        ${sessionLine()}
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
      <p class="results__saved" role="status" aria-live="polite">${escapeHtml(state.keeping?.status ?? '')}</p>
      ${
        state.keeping?.naming
          ? `<div class="keep">
               <label class="keep__label" for="keep-name">Name this set</label>
               <input type="text" id="keep-name" value="${escapeHtml(state.keeping.name)}"
                      maxlength="${MAX_NAME}" autocomplete="off" />
               <div class="keep__row">
                 <button class="btn btn--secondary" id="keep-cancel">Cancel</button>
                 <button class="btn" id="keep-save">Save it</button>
               </div>
             </div>`
          : `${
              missed.length
                ? `<button class="btn btn--secondary" id="retry">
                     ${more ? `Try the ${missed.length} just missed` : `Practice the ${missed.length} you missed`}
                   </button>
                   <button class="btn btn--secondary" id="keep-start">
                     Keep ${missed.length === 1 ? 'it' : `these ${missed.length}`} as a set
                   </button>`
                : ''
            }
            <button class="btn ${more || missed.length ? 'btn--secondary' : ''}" id="restart">
              ${more ? 'Back to home' : 'Start over'}
            </button>
            ${
              /* Last, and deliberately. During a round the ✓ and ✗ buttons sit
                 in this same strip, so whatever lands at the bottom is where a
                 thumb already is — and answering three cards in a rhythm should
                 not be able to quit the session. The harmless action takes that
                 spot; leaving is one row up. */
              more
                ? `<button class="btn" id="next-round">
                     Next round · ${state.session.plan[state.session.roundIndex + 1]} cards
                   </button>`
                : ''
            }`
      }
    </div>`

  bindMenus()
  document.getElementById('next-round')?.addEventListener('click', nextRound)
  if (missed.length && document.getElementById('retry')) {
    document.getElementById('retry').addEventListener('click', practiceMissed)
  }
  document.getElementById('restart')?.addEventListener('click', () => {
    // Mid-session this button means "stop", which is going home, not starting
    // the whole thing again.
    if (more) return goHome()
    restart()
  })

  /* Naming happens here rather than in the builder. The builder exists to FIND
     words; these words are already in hand, and sending someone to a search
     screen to name seven things they just saw would be a detour away from the
     moment that made them want it. */
  document.getElementById('keep-start')?.addEventListener('click', () => {
    state.keeping = { naming: true, name: defaultKeepName(), status: '' }
    render()
    const field = document.getElementById('keep-name')
    field?.focus()
    field?.select()
  })
  document.getElementById('keep-cancel')?.addEventListener('click', () => {
    state.keeping = null
    render()
  })
  const keepField = document.getElementById('keep-name')
  keepField?.addEventListener('input', () => {
    state.keeping.name = keepField.value
    const save = document.getElementById('keep-save')
    if (save) save.disabled = !keepField.value.trim()
  })
  document.getElementById('keep-save')?.addEventListener('click', () => keepMissed(missed))

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
  paint()
  // After the screen exists, so a 14 KB write never sits between a tap and
  // the paint that answers it.
  persistSession()
}

function paint() {
  if (state.screen === 'home') return renderHome()
  if (state.screen === 'sets') return renderSets()
  if (state.screen === 'manage') return renderManage()
  if (state.screen === 'format') return renderFormat()
  if (state.screen === 'settings') return renderSettings()
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
   person has never chosen. */
loadUserSets()
rebuildMembership()
loadPrefs()
/* After rebuildMembership and loadPrefs, because a stored session resolves its
   written forms through cardByForm and its set ids through the manifest.

   Deliberately only an OFFER: setting state.screen here would fight the shared
   link below, and would drop someone into a round they may not have opened the
   app for. Home shows the card; its click handler does the rest. */
loadSession()

if (sharedPayload) {
  /* A shared link wins over anything else at boot. It is why they opened the
     app. */
  state.incoming = { state: 'loading' }
  state.screen = 'receive'
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
  render()
  receiveShared(payload)
})
