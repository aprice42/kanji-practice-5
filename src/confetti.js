// Tiny self-contained confetti burst. No dependency, so it still works offline.

const COLORS = ['#f2c94c', '#eb5757', '#2f80ed', '#27ae60', '#bb6bd9', '#f2994a']
const DURATION = 2600
const GRAVITY = 0.12
const DRAG = 0.995

function makePiece(width) {
  return {
    x: width / 2 + (Math.random() - 0.5) * width * 0.5,
    y: -20 - Math.random() * 80,
    vx: (Math.random() - 0.5) * 5,
    vy: 1 + Math.random() * 3,
    size: 6 + Math.random() * 7,
    tilt: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.25,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }
}

export function confetti() {
  // Decorative only — skip entirely for people who ask for reduced motion.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

  const canvas = document.createElement('canvas')
  canvas.className = 'confetti'
  canvas.setAttribute('aria-hidden', 'true')
  document.body.appendChild(canvas)

  const dpr = window.devicePixelRatio || 1
  const width = window.innerWidth
  const height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    canvas.remove()
    return
  }
  ctx.scale(dpr, dpr)

  const pieces = Array.from({ length: 140 }, () => makePiece(width))
  const start = performance.now()

  function frame(now) {
    const elapsed = now - start
    if (elapsed > DURATION) {
      canvas.remove()
      return
    }

    // Fade the whole burst out over the last third.
    canvas.style.opacity = String(Math.min(1, (DURATION - elapsed) / (DURATION / 3)))
    ctx.clearRect(0, 0, width, height)

    for (const p of pieces) {
      p.vy += GRAVITY
      p.vx *= DRAG
      p.x += p.vx
      p.y += p.vy
      p.tilt += p.spin

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.tilt)
      ctx.fillStyle = p.color
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
      ctx.restore()
    }

    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
