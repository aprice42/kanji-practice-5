/* Trace mode's canvas: the guide, the pointer, and the stroke queue.

   This module owns everything that happens inside one card, and deliberately
   never calls back into render(). render() blows the whole app away and rebuilds
   it, which a canvas mid-stroke cannot survive — so within a card the canvas
   mutates itself and the status line is written by textContent, the same way
   setTheme() updates an open menu in place. mountTrace returns a teardown that
   render() calls, so a menu opened mid-stroke cannot leave an animation frame
   or a captured pointer behind. */

import { strokesFor, hasStrokes, STROKE_VIEWBOX } from './strokes-geom.js'
import { matchStroke, DEBUG } from './trace-match.js'

const reduceMotion =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/* A card is scored correct if it was completed with no more than this many
   rejected strokes across the whole word. Tracing is practice, not a test — one
   slip should not cost the card. */
const RETRY_BUDGET = 2

/* After this many failures on one stroke the guide replays and the tolerance
   drops, so he is never stuck on a stroke he cannot satisfy. */
const RESCUE_AFTER = 3
const RESCUE_STRICTNESS = 0.6

/* The last line of defence. Rescue is meant to guarantee he can always move on,
   but that guarantee only holds if every tolerance really does loosen — and one
   of them once did the opposite, which trapped him on a stroke he was drawing
   correctly, replaying the guide forever. A ten-year-old cannot debug a
   tolerance. After this many tries the stroke is accepted whatever the matcher
   thinks; the attempts are still counted, so the card still scores as missed. */
const GIVE_UP_AFTER = 6

/* Pointer samples closer together than this are noise, not signal. */
const MIN_STEP_PX = 1.5

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export function mountTrace(root, card, { onFinish }) {
  const canvas = root.querySelector('.trace__canvas')
  const status = root.querySelector('.trace__status')
  const strip = root.querySelector('.trace__strip')
  const showBtn = root.querySelector('#trace-show')

  const chars = [...card.written]
  const ctx = canvas.getContext('2d')

  /* Colours are read once and refreshed when the palette or theme attribute
     changes. Reading them per frame would mean a getComputedStyle on every
     animation frame; reading them only at mount is wrong, because setTheme()
     deliberately does NOT re-render — it updates in place so an open menu stays
     open — and the canvas would keep painting the old palette underneath the
     newly recoloured UI. */
  let colors = readColors()

  function readColors() {
    /* --muted, not --edge: the ghost is a mark to be followed, not a border, and
       --edge at any usable alpha never clears 3:1 against the cell. At 0.7 this
       measures 3.0 to 4.1 across all eight palette x theme combinations, faint
       enough to stay behind the inked strokes and solid enough to trace.
       --primary-text, not --primary: --primary is a button FILL, meant to carry
       white text on top. As a mark on the cell it measures 1.8:1 on ink/dark —
       the guide is the most important thing on screen and would be invisible.
       --primary-text is the same hue built to be read, 5.4 to 10.0 throughout. */
    return {
      ghost: token('--muted'),
      guide: token('--primary-text'),
      ink: token('--ink'),
      good: token('--good'),
      bad: token('--bad'),
    }
  }

  let charIndex = 0
  let strokeIndex = 0
  let revealed = false // the ghost is off until "Show me"
  let attempts = 0 // failures on the current stroke
  let retries = 0 // failures across the whole card
  let drawing = null // { pointerId, pointerType, points }
  let flash = null // { color, until } — the accept/reject tint
  let guide = null // { started, duration } while the guide animates
  let frame = null
  let scale = 1 // CSS px per glyph unit
  let size = 0 // the square cell's side, in CSS px
  let finished = false

  /* Characters with no stroke data (a card added without rerunning
     `npm run strokes`) are passed over rather than breaking the round. */
  const traceable = (i) => hasStrokes(chars[i])
  const refs = () => strokesFor(chars[charIndex])

  /* ---- sizing ---------------------------------------------------------- */

  function resize() {
    const rect = canvas.getBoundingClientRect()
    size = Math.min(rect.width, rect.height)
    if (!size) return
    const dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    scale = size / STROKE_VIEWBOX
  }

  /* Pointer position in glyph units. Everything downstream — the matcher, every
     tolerance — works in these, so cell size never changes how forgiving the
     app is. */
  function toGlyph(event) {
    const rect = canvas.getBoundingClientRect()
    const offsetX = (rect.width - size) / 2
    const offsetY = (rect.height - size) / 2
    return {
      x: (event.clientX - rect.left - offsetX) / scale,
      y: (event.clientY - rect.top - offsetY) / scale,
    }
  }

  /* ---- painting -------------------------------------------------------- */

  function paint() {
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.scale(scale, scale)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const list = refs()
    if (list) {
      // Strokes already accepted: the character building up.
      ctx.strokeStyle = colors.ink
      ctx.lineWidth = 5.5
      for (let i = 0; i < strokeIndex; i++) ctx.stroke(list[i].path2d)

      // The ghost of what is still to come, once he has asked for it.
      if (revealed) {
        ctx.save()
        ctx.globalAlpha = 0.7
        ctx.strokeStyle = colors.ghost
        ctx.lineWidth = 5
        for (let i = strokeIndex; i < list.length; i++) ctx.stroke(list[i].path2d)
        ctx.restore()
      }

      // The current stroke drawing itself, after "Show me".
      const current = list[strokeIndex]
      if (guide && current) {
        const t = reduceMotion ? 1 : Math.min(1, (performance.now() - guide.started) / guide.duration)
        ctx.save()
        ctx.strokeStyle = colors.guide
        ctx.lineWidth = 6
        ctx.setLineDash([current.length, current.length])
        ctx.lineDashOffset = current.length * (1 - t)
        ctx.stroke(current.path2d)
        ctx.restore()
        if (t >= 1) guide = null
      }
    }

    // What the finger is drawing right now.
    if (drawing && drawing.points.length > 1) {
      ctx.strokeStyle = flash ? flash.color : colors.guide
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(drawing.points[0].x, drawing.points[0].y)
      for (const p of drawing.points.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
    }

    // A rejected stroke lingers briefly in the wrong-colour so he can see what
    // he drew before it clears.
    if (flash && flash.points) {
      ctx.strokeStyle = flash.color
      ctx.globalAlpha = Math.max(0, (flash.until - performance.now()) / flash.fade)
      ctx.lineWidth = 6
      ctx.beginPath()
      ctx.moveTo(flash.points[0].x, flash.points[0].y)
      for (const p of flash.points.slice(1)) ctx.lineTo(p.x, p.y)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.restore()
  }

  function tick() {
    if (finished) return
    if (flash && performance.now() > flash.until) flash = null
    paint()
    const busy = guide || flash || drawing
    frame = busy ? requestAnimationFrame(tick) : null
  }

  function wake() {
    if (!frame && !finished) frame = requestAnimationFrame(tick)
    else paint()
  }

  /* ---- the word strip -------------------------------------------------- */

  /* A character is only legible once he has earned it — by drawing it, or by
     asking. Showing the whole word here would hand him the answer the prompt is
     asking him to recall, which is the entire point of the mode. Hidden ones
     keep their box so the word's length and his position in it still read. */
  function paintStrip() {
    for (const [i, span] of [...strip.children].entries()) {
      const done = i < charIndex
      const active = i === charIndex
      span.classList.toggle('is-done', done)
      span.classList.toggle('is-active', active)
      span.classList.toggle('is-masked', !done && !(active && revealed))
    }
  }

  function say(text) {
    status.textContent = text
  }

  function strokeLabel() {
    const list = refs()
    if (!list) return ''
    return `Stroke ${strokeIndex + 1} of ${list.length}`
  }

  /* ---- the guide ------------------------------------------------------- */

  function showGuide() {
    const list = refs()
    if (!list) return
    revealed = true
    const current = list[strokeIndex]
    guide = {
      started: performance.now(),
      duration: Math.min(1100, Math.max(400, 260 + current.length * 2.2)),
    }
    say(`${strokeLabel()} — watch, then trace it`)
    syncReveal()
    wake()
  }

  function hideGuide() {
    revealed = false
    guide = null
    say(strokeLabel())
    syncReveal()
    wake()
  }

  /* One button, two states. Toggling back off lets him take another run at it
     from memory without losing the strokes he has already drawn. */
  function toggleReveal() {
    if (revealed) hideGuide()
    else showGuide()
  }

  function syncReveal() {
    showBtn.textContent = revealed ? 'Hide it' : 'Show me'
    showBtn.setAttribute('aria-pressed', String(revealed))
    paintStrip()
  }

  /* ---- advancing ------------------------------------------------------- */

  function nextChar() {
    charIndex++
    while (charIndex < chars.length && !traceable(charIndex)) charIndex++
    strokeIndex = 0
    attempts = 0
    revealed = false
    if (charIndex >= chars.length) return finish()
    syncReveal()
    canvas.setAttribute('aria-label', `Trace ${chars[charIndex]} — ${strokeLabel()}`)
    say(`Next character — ${strokeLabel()}`)
    wake()
  }

  function accept(points) {
    strokeIndex++
    attempts = 0
    const list = refs()
    flash = { color: colors.good, until: performance.now() + 260, fade: 260, points }
    if (strokeIndex >= list.length) {
      say(`${chars[charIndex]} done`)
      setTimeout(() => !finished && nextChar(), 320)
    } else {
      canvas.setAttribute('aria-label', `Trace ${chars[charIndex]} — ${strokeLabel()}`)
      say(`Good — ${strokeLabel()}`)
    }
    wake()
  }

  function reject(points, reason) {
    attempts++
    retries++
    flash = { color: colors.bad, until: performance.now() + 420, fade: 420, points }
    const nudge =
      reason === 'direction'
        ? 'Try it the other way'
        : reason === 'start'
          ? 'Start it from the other end'
          : 'Not quite — try again'
    say(`${nudge}. ${strokeLabel()}`)
    if (attempts >= RESCUE_AFTER) setTimeout(() => !finished && showGuide(), 200)
    wake()
  }

  function finish() {
    if (finished) return
    finished = true
    onFinish(retries <= RETRY_BUDGET ? 'correct' : 'incorrect')
  }

  /* ---- pointer --------------------------------------------------------- */

  function onDown(event) {
    if (drawing || finished || !refs()) return
    event.preventDefault()
    /* Capture keeps the stroke alive when the finger leaves the cell, but it is
       an optimisation, not a requirement — and it throws if the pointer is no
       longer active by the time this runs. Letting that escape would abandon
       the stroke before it started, which looks like the canvas ignoring him. */
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      /* drawing continues uncaptured */
    }
    drawing = { pointerId: event.pointerId, pointerType: event.pointerType, points: [toGlyph(event)] }
    flash = null
    wake()
  }

  function onMove(event) {
    // A second finger or a resting palm is a different pointerId; ignoring it is
    // the whole of palm rejection.
    if (!drawing || event.pointerId !== drawing.pointerId) return
    event.preventDefault()
    /* A fast diagonal on a 120Hz screen arrives as a handful of move events with
       several real samples coalesced inside each. Without these the polyline is
       too coarse to compare.

       The empty-list check is not paranoia: getCoalescedEvents can return [],
       and `?? [event]` does not catch that — an empty array is not nullish. The
       stroke then collects only its first point and every trace is rejected for
       zero length. */
    const coalesced = event.getCoalescedEvents?.() ?? []
    const events = coalesced.length ? coalesced : [event]
    for (const e of events) {
      const p = toGlyph(e)
      const last = drawing.points[drawing.points.length - 1]
      if (Math.hypot(p.x - last.x, p.y - last.y) * scale < MIN_STEP_PX) continue
      drawing.points.push(p)
    }
    wake()
  }

  function onUp(event) {
    if (!drawing || event.pointerId !== drawing.pointerId) return
    event.preventDefault()
    const { points, pointerType } = drawing
    drawing = null
    const list = refs()
    if (!list) return

    const strictness = attempts >= RESCUE_AFTER ? RESCUE_STRICTNESS : 1
    const result = matchStroke(points, list[strokeIndex], { pointerType, strictness })
    if (result.ok || attempts >= GIVE_UP_AFTER) accept(points)
    else reject(points, result.reason)
  }

  function onCancel(event) {
    if (!drawing || event.pointerId !== drawing.pointerId) return
    drawing = null
    wake()
  }

  /* ---- wiring ---------------------------------------------------------- */

  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onCancel)
  showBtn.addEventListener('click', toggleReveal)

  const onResize = () => {
    resize()
    paint()
  }
  addEventListener('resize', onResize)

  /* setTheme() and setPalette() restamp these attributes without re-rendering,
     so this is the only signal the canvas gets that its colours have moved. */
  const palette = new MutationObserver(() => {
    colors = readColors()
    paint()
  })
  palette.observe(document.documentElement, { attributeFilter: ['data-theme', 'data-palette'] })

  // Skip any leading characters with no stroke data.
  while (charIndex < chars.length && !traceable(charIndex)) charIndex++
  resize()
  syncReveal()
  if (charIndex >= chars.length) {
    // Nothing in this word can be traced — do not strand him on a blank cell.
    say('No stroke data for this card')
    setTimeout(finish, 0)
  } else {
    canvas.setAttribute('aria-label', `Trace ${chars[charIndex]} — ${strokeLabel()}`)
    say(strokeLabel())
    paint()
  }

  if (DEBUG) console.log('[trace] card', card.written, chars.map((c) => (hasStrokes(c) ? strokesFor(c).length : '-')))

  return function teardown() {
    finished = true
    if (frame) cancelAnimationFrame(frame)
    palette.disconnect()
    removeEventListener('resize', onResize)
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerup', onUp)
    canvas.removeEventListener('pointercancel', onCancel)
    showBtn.removeEventListener('click', toggleReveal)
  }
}
