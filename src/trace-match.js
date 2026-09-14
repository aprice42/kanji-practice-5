/* Deciding whether a drawn stroke traced the right stroke.

   Everything is in glyph units (0..109), never pixels, so a tolerance means the
   same thing at every cell size. Six metrics, all of which must pass. They are
   separate rather than rolled into one score because each one catches something
   the others cannot:

   - startDist alone separates the three horizontals of 三, which have almost
     identical shape and direction.
   - dirCos is what makes this stroke ORDER rather than shape matching: without
     it, 一 drawn right to left passes.
   - meanDev catches a stroke that starts and ends in the right place but bulges
     through the wrong part of the character.

   The numbers are a starting hypothesis tuned by watching someone actually
   trace, not a derivation. `?trace=debug` logs all six per stroke. */

import { resample, polylineLength, SAMPLES } from './strokes-geom.js'

export const TOLERANCE = {
  startDist: 18,
  endDist: 22,
  meanDev: 13,
  maxDev: 30,
  dirCos: 0.4,
  lenRatioMin: 0.45,
  lenRatioMax: 2.0,

  /* Below this length a stroke is a dot — the two 点 of ッ and the like, 8 to 14
     units. At that scale direction is hand jitter and length ratio is
     meaningless, because a child taps rather than drags and produces a single
     point. Judging those on position alone is the difference between the app
     being usable and it telling him he is wrong when he is not. */
  shortStroke: 16,
  shortStartDist: 16,
  shortEndDist: 18,
}

/* A trackpad and a finger are not the same instrument and pretending they are
   makes one of them miserable. On a trackpad he cannot see his hand against the
   target, so he starts in the wrong place but draws smoothly. With a finger he
   lands accurately and then wobbles, and the finger covers the guide. */
const POINTER_BIAS = {
  touch: { dev: 1.25, ends: 1 },
  pen: { dev: 1.25, ends: 1 },
  mouse: { dev: 1, ends: 1.4 },
}

const biasFor = (pointerType) => POINTER_BIAS[pointerType] ?? POINTER_BIAS.touch

export const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('trace') === 'debug'

function chord(points) {
  const a = points[0]
  const b = points[points.length - 1]
  return { x: b.x - a.x, y: b.y - a.y }
}

function cosBetween(a, b) {
  const ma = Math.hypot(a.x, a.y)
  const mb = Math.hypot(b.x, b.y)
  if (ma === 0 || mb === 0) return 1 // a dot has no direction to disagree about
  return (a.x * b.x + a.y * b.y) / (ma * mb)
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

/* `drawn` is the raw pointer polyline in glyph units; `reference` is one entry
   from strokesFor(). `strictness` scales every tolerance — below 1 is more
   forgiving, and the caller drops it after repeated failures so he is never
   stuck on one stroke. */
export function matchStroke(drawn, reference, { pointerType = 'touch', strictness = 1 } = {}) {
  if (!drawn.length) return { ok: false, reason: 'empty' }

  const bias = biasFor(pointerType)
  const ease = (limit, factor) => (limit * factor) / strictness

  const user = resample(drawn, SAMPLES)
  const ref = reference.points
  const startDist = dist(user[0], ref[0])
  const endDist = dist(user[SAMPLES - 1], ref[SAMPLES - 1])

  /* Dots: position only. Nothing else at this scale carries signal. */
  if (reference.length < TOLERANCE.shortStroke) {
    const ok =
      startDist <= ease(TOLERANCE.shortStartDist, bias.ends) &&
      endDist <= ease(TOLERANCE.shortEndDist, bias.ends)
    const metrics = { short: true, startDist, endDist }
    if (DEBUG) console.log('[trace] dot', { ok, ...metrics })
    return { ok, reason: ok ? null : 'place', metrics }
  }

  let sum = 0
  let max = 0
  for (let i = 0; i < SAMPLES; i++) {
    const d = dist(user[i], ref[i])
    sum += d
    if (d > max) max = d
  }
  const meanDev = sum / SAMPLES
  const maxDev = max
  const dirCos = cosBetween(chord(user), chord(ref))
  const lenRatio = polylineLength(user) / reference.length

  const checks = {
    startDist: startDist <= ease(TOLERANCE.startDist, bias.ends),
    endDist: endDist <= ease(TOLERANCE.endDist, bias.ends),
    meanDev: meanDev <= ease(TOLERANCE.meanDev, bias.dev),
    maxDev: maxDev <= ease(TOLERANCE.maxDev, bias.dev),
    dirCos: dirCos >= TOLERANCE.dirCos * strictness,
    lenRatio: lenRatio >= TOLERANCE.lenRatioMin / strictness && lenRatio <= TOLERANCE.lenRatioMax * strictness,
  }
  const ok = Object.values(checks).every(Boolean)
  const metrics = { startDist, endDist, meanDev, maxDev, dirCos, lenRatio }

  if (DEBUG) console.log('[trace]', { ok, ...metrics, checks, pointerType, strictness })

  /* The reason is only ever used to phrase the nudge. Direction is worth calling
     out by name — being told "the other way" is actionable in a way that "not
     quite" is not. */
  let reason = null
  if (!ok) {
    if (!checks.dirCos) reason = 'direction'
    else if (!checks.startDist) reason = 'start'
    else reason = 'shape'
  }
  return { ok, reason, metrics }
}
