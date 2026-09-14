/* Geometry for Trace mode: turning a KanjiVG path string into something that can
   be drawn, animated, and compared against what the user drew.

   Everything here works in glyph units — the 0..STROKE_VIEWBOX box the KanjiVG
   data is authored in — never pixels. Tolerances in trace-match.js are stated in
   those units, so they mean the same thing on a phone and on an iPad and do not
   have to be rethought when the cell changes size. */

import { strokes, STROKE_VIEWBOX } from './strokes.js'

export { STROKE_VIEWBOX }

/* How many points each stroke is resampled to. The user's stroke gets the same
   count, so the two become comparable index by index. */
export const SAMPLES = 24

/* getPointAtLength needs an SVGPathElement, and a path that has never been in
   the document is not reliable everywhere — Chromium answers, but WebKit and
   Firefox have historically returned zero. One hidden SVG, reused for every
   measurement, avoids that without costing a layout. */
let measurer = null

function measure(d) {
  if (!measurer) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('aria-hidden', 'true')
    svg.style.position = 'absolute'
    measurer = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.appendChild(measurer)
    document.body.appendChild(svg)
  }
  measurer.setAttribute('d', d)
  return measurer
}

/* One stroke, sampled at equal arc-length intervals. */
function sampleStroke(d) {
  const path = measure(d)
  const length = path.getTotalLength()
  const points = []
  for (let i = 0; i < SAMPLES; i++) {
    const p = path.getPointAtLength((length * i) / (SAMPLES - 1))
    points.push({ x: p.x, y: p.y })
  }
  return {
    d,
    length,
    points,
    start: points[0],
    end: points[points.length - 1],
    // Path2D is what the canvas actually draws. KanjiVG paths are centre lines,
    // not outlines, so they must be stroked — filling one draws nothing.
    path2d: new Path2D(d),
  }
}

/* Sampling is cheap but not free, and a card revisits the same character every
   time its stroke is redrawn, so keep it. Only the characters on screen are
   ever sampled — the deck's other 70-odd never touch this. */
const cache = new Map()

export function strokesFor(char) {
  if (cache.has(char)) return cache.get(char)
  const paths = strokes[char]
  // A character added to the deck without rerunning `npm run strokes` has no
  // data. Trace mode shows it as plain text and passes over it rather than
  // breaking the round.
  const sampled = paths ? paths.map(sampleStroke) : null
  cache.set(char, sampled)
  return sampled
}

export function hasStrokes(char) {
  return Boolean(strokes[char])
}

/* Resample an arbitrary polyline — what the pointer produced — to SAMPLES points
   spaced equally along its length, so it lines up with a reference stroke point
   for point. A tap that produced one point becomes a still line of that point,
   which is what the short-stroke branch in trace-match.js expects. */
export function resample(points, count = SAMPLES) {
  if (points.length === 0) return []
  if (points.length === 1) return Array.from({ length: count }, () => ({ ...points[0] }))

  const spans = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    spans.push(len)
    total += len
  }
  if (total === 0) return Array.from({ length: count }, () => ({ ...points[0] }))

  const out = [{ ...points[0] }]
  const step = total / (count - 1)
  let span = 0
  let walked = 0 // distance already accounted for before the current span
  for (let i = 1; i < count - 1; i++) {
    const target = step * i
    while (span < spans.length - 1 && walked + spans[span] < target) {
      walked += spans[span]
      span++
    }
    const t = spans[span] === 0 ? 0 : (target - walked) / spans[span]
    const a = points[span]
    const b = points[span + 1]
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  out.push({ ...points[points.length - 1] })
  return out
}

export function polylineLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return total
}
