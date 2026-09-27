import { useLayoutEffect, useRef } from "react"

const BAYER = [
  [0, 48, 12, 60, 3, 51, 15, 63],
  [32, 16, 44, 28, 35, 19, 47, 31],
  [8, 56, 4, 52, 11, 59, 7, 55],
  [40, 24, 36, 20, 43, 27, 39, 23],
  [2, 50, 14, 62, 1, 49, 13, 61],
  [34, 18, 46, 30, 33, 17, 45, 29],
  [10, 58, 6, 54, 9, 57, 5, 53],
  [42, 26, 38, 22, 41, 25, 37, 21],
]
const clamp = (value: number) => Math.max(0, Math.min(1, value))

// Pixels keep their screen coordinates. A passing threshold turns each one on
// and off, rather than translating a texture underneath the session text.
export function CompletionPixels({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext("2d")
    if (!canvas || !context) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    let frame = 0, lastPaint = -Infinity, width = 0, height = 0
    const color = getComputedStyle(canvas).color
    const paint = () => {
      context.clearRect(0, 0, width, height)
      context.fillStyle = color
      const progress = clamp((Date.now() - startedAt) / 3000)
      // A solid leading band followed by a thinning dither trail. Each fixed
      // cell switches on as the front reaches it, then switches off once as
      // its Bayer rank is crossed; the pattern itself never translates.
      const head = .065, trail = .48
      const front = reduced.matches ? 1 : progress * (1 + trail)
      for (let x = 0, col = 0; x < width; x += 2, col++) {
        const behind = front - x / width
        const dissolve = (behind - head) / (trail - head)
        for (let y = 0, row = 0; y < height; y += 2, row++) {
          const rank = (BAYER[row % 8][col % 8] + .5) / 64
          if (behind >= 0 && (behind <= head || (behind < trail && rank > dissolve))) context.fillRect(x, y, 2, 2)
        }
      }
    }
    const resize = () => {
      const bounds = canvas.getBoundingClientRect(), scale = window.devicePixelRatio || 1
      width = bounds.width; height = bounds.height
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
      context.setTransform(scale, 0, 0, scale, 0, 0)
      paint()
    }
    const animate = (now: number) => {
      // This small, short-lived surface needs no more than 30 updates/second.
      if (now - lastPaint >= 1000 / 30) { paint(); lastPaint = now }
      if (Date.now() - startedAt < 3000 && !reduced.matches) frame = requestAnimationFrame(animate)
    }
    const preferenceChanged = () => {
      cancelAnimationFrame(frame)
      paint()
      if (!reduced.matches) frame = requestAnimationFrame(animate)
    }
    const observer = new ResizeObserver(resize)
    resize(); observer.observe(canvas)
    if (!reduced.matches) frame = requestAnimationFrame(animate)
    reduced.addEventListener("change", preferenceChanged)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); reduced.removeEventListener("change", preferenceChanged) }
  }, [startedAt])
  return <canvas ref={ref} className="completion-pixels" aria-hidden="true" />
}
