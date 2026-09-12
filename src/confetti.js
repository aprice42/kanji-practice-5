// Self-contained confetti. No dependency, so it still works offline.

const COLORS = [
  '#f2c94c', '#eb5757', '#2f80ed', '#27ae60',
  '#bb6bd9', '#f2994a', '#56ccf2', '#ff6fb5',
]
const DURATION = 6000
const GRAVITY = 0.11
const DRAG = 0.992
const TERMINAL = 9

const rand = (min, max) => min + Math.random() * (max - min)
const pick = (list) => list[Math.floor(Math.random() * list.length)]

function piece(x, y, vx, vy) {
  return {
    x, y, vx, vy,
    size: rand(7, 16),
    shape: pick(['ribbon', 'ribbon', 'square', 'circle']),
    color: pick(COLORS),
    tilt: rand(0, Math.PI * 2),
    spin: rand(-0.3, 0.3),
    // Each piece flutters on its own phase so the fall never looks uniform.
    wobble: rand(0, Math.PI * 2),
    wobbleSpeed: rand(0.05, 0.14),
    wobbleAmount: rand(0.4, 1.8),
  }
}

// A cannon firing from a bottom corner toward the middle of the screen.
function cannon(count, w, h, fromLeft) {
  const x = fromLeft ? -10 : w + 10
  const aim = fromLeft ? 1 : -1
  return Array.from({ length: count }, () =>
    piece(x, h * rand(0.6, 0.95), aim * rand(6, 10), rand(-6, -16))
  )
}

// A curtain of confetti falling from above the top edge.
function rain(count, w) {
  return Array.from({ length: count }, () =>
    piece(rand(-40, w + 40), rand(-140, -20), rand(-2.2, 2.2), rand(1, 4))
  )
}

// A burst from a point, radiating in all directions.
function burst(count, x, y) {
  return Array.from({ length: count }, () => {
    const angle = rand(0, Math.PI * 2)
    const speed = rand(3, 13)
    return piece(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed - 4)
  })
}

export function confetti() {
  // Decorative only — skip entirely for people who ask for reduced motion.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.createElement('canvas')
  canvas.className = 'confetti'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight
  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)

  // Waves keep it going instead of one puff that's over before you look up.
  const waves = [
    { at: 0, make: () => [...cannon(130, w, h, true), ...cannon(130, w, h, false)] },
    { at: 0, make: () => rain(200, w) },
    { at: 450, make: () => burst(180, w / 2, h * 0.38) },
    { at: 900, make: () => [...cannon(110, w, h, true), ...cannon(110, w, h, false)] },
    { at: 1400, make: () => rain(220, w) },
    { at: 2000, make: () => [...burst(90, w * 0.25, h * 0.3), ...burst(90, w * 0.75, h * 0.3)] },
    { at: 2800, make: () => rain(200, w) },
  ]

  let pieces = []
  const start = performance.now()
  let fired = 0

  function frame(now) {
    const elapsed = now - start

    while (fired < waves.length && elapsed >= waves[fired].at) {
      pieces = pieces.concat(waves[fired].make())
      fired++
    }

    if (elapsed > DURATION) {
      canvas.remove()
      return
    }

    // Fade the whole thing out over the last stretch.
    canvas.style.opacity = String(Math.min(1, (DURATION - elapsed) / 1200))
    ctx.clearRect(0, 0, w, h)

    for (const p of pieces) {
      p.vy = Math.min(p.vy + GRAVITY, TERMINAL)
      p.vx *= DRAG
      p.wobble += p.wobbleSpeed
      p.x += p.vx + Math.sin(p.wobble) * p.wobbleAmount
      p.y += p.vy
      p.tilt += p.spin

      if (p.y > h + 40) continue

      // setTransform beats save/rotate/restore when there are this many pieces.
      const cos = Math.cos(p.tilt)
      const sin = Math.sin(p.tilt)
      ctx.setTransform(cos * dpr, sin * dpr, -sin * dpr, cos * dpr, p.x * dpr, p.y * dpr)
      ctx.fillStyle = p.color

      if (p.shape === 'circle') {
        ctx.beginPath()
        ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2)
        ctx.fill()
      } else if (p.shape === 'square') {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size)
      } else {
        // Ribbons squash as they spin, which reads as tumbling in 3D.
        ctx.fillRect(-p.size / 2, -p.size / 5, p.size, (p.size / 2.5) * Math.abs(cos))
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Drop pieces that have fallen away so late waves stay cheap.
    if (pieces.length > 400) pieces = pieces.filter((p) => p.y <= h + 40)

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
