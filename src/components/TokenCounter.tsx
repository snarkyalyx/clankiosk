import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"

const CELL = 44        // px, one step: the distance from one digit to the next
const WIN = 76         // px, the window a wheel is read through
const WHEEL_W = 34     // px, glyph advance for tabular figures at 56px
// A wheel turns over the last stretch of its own step, and that stretch is
// capped in tokens. Left proportional, the leading wheel spends millions of
// tokens half turned and reads one digit high for minutes at a time - which is
// the difference between a meter reading 398 and one reading 499 for a total of
// 398 million. Capped, every wheel turns inside a few seconds of consumption
// and then stands square in its window again.
const ROLL_FRAC = 0.18
const ROLL_MAX = 0.4   // display units: the longest a wheel may spend turning
// The outgoing digit keeps the window until the turn is nearly done, so the
// figure reads as the lower digit for as long as the wheel is still moving.
const HAND_FROM = 0.7

function smoothstep(x: number) {
  const f = x <= 0 ? 0 : x >= 1 ? 1 : x
  return f * f * (3 - 2 * f)
}

// A wheel is two glyphs stacked in flow inside a window taller than they travel.
// Nothing is positioned here: the animation writes straight to these nodes, so
// the wheel renders once and is then driven by style writes alone.
function Wheel() {
  return (
    <span
      className="wheel relative shrink-0 overflow-hidden text-foreground"
      style={{ width: WHEEL_W, height: WIN, paddingTop: (WIN - CELL) / 2 }}
    >
      {[0, 1].map((i) => (
        <span
          key={i}
          data-glyph={i}
          className="value block text-center"
          style={{ height: CELL, lineHeight: CELL + "px", fontSize: 56, transform: "translateY(0px)" }}
        >
          0
        </span>
      ))}
      <span className="wheel-shade pointer-events-none absolute inset-0" />
    </span>
  )
}

// One glyph of a drum: it rides up with the wheel's roll and turns away from
// the eye as it leaves the middle of the window. A small rotation and a small
// squeeze is all it takes to read as a drum rather than a sliding card.
function paintGlyph(node: Element, digit: number, roll: number, opacity: number, p: number) {
  const text = String(digit)
  if (node.textContent !== text) node.textContent = text
  const style = (node as HTMLElement).style
  style.opacity = String(opacity)
  style.transform =
    "translateY(" + (-roll * CELL) + "px) rotateX(" + (p * 24) + "deg) scaleX(" + (1 - 0.045 * Math.abs(p)) + ")"
}

// Hands the wheel its new position. Hand-off happens across the middle of the
// turn: the outgoing digit is held solid while it is still the one being read,
// then swaps over, so two digits never share the window at half strength.
function paintWheel(el: Element, exp: number, units: number) {
  const step = Math.pow(10, exp)
  const turn = Math.min(ROLL_FRAC * step, ROLL_MAX)
  const pos = (units / step) % 10
  const base = Math.floor(pos)
  const frac = pos - base
  const from = 1 - turn / step
  const roll = frac <= from ? 0 : smoothstep((frac - from) / (1 - from))
  const d0 = ((base % 10) + 10) % 10
  const d1 = (d0 + 1) % 10
  const hand = Math.max(0, Math.min(1, (roll - HAND_FROM) / (1 - HAND_FROM)))
  const glyphs = el.querySelectorAll("[data-glyph]")
  if (glyphs.length < 2) return
  paintGlyph(glyphs[0], d0, roll, 1 - hand, -roll)
  paintGlyph(glyphs[1], d1, roll, hand, 1 - roll)
}

const scaleFor = (tokens: number) => tokens >= 1e6 ? 1e6 : tokens >= 1e3 ? 1e3 : 1
const placesFor = (tokens: number) =>
  Math.max(1, Math.min(6, Math.floor(Math.log10(Math.max(1, Math.max(0, tokens) / scaleFor(tokens)))) + 1))

export type OdometerHandle = { paint: (tokens: number) => void }

// The scaled figure as a row of wheels, most significant first, thousands
// group split by a comma, and only as many wheels as the number actually has.
// Each wheel reads the value at its own decimal place, so the column carries
// like a geared counter instead of separate digits.
//
// The animation drives it through the ref, not through props: a React render of
// this card costs a full pass over every model row, and at 60 fps that is what
// made the counter feel like it was wading through treacle. Painting writes a
// dozen style properties on nodes that already exist.
export const Odometer = forwardRef<OdometerHandle, { tokens: number }>(function Odometer({ tokens }, ref) {
  const [places, setPlaces] = useState(() => placesFor(tokens))
  const [scale, setScale] = useState(() => scaleFor(tokens))
  const rowRef = useRef<HTMLDivElement>(null)
  const placesRef = useRef(places)
  placesRef.current = places

  useImperativeHandle(ref, () => ({
    paint: (t) => {
      const row = rowRef.current
      if (!row) return
      const need = placesFor(t)
      const nextScale = scaleFor(t)
      if (need !== placesRef.current || nextScale !== scale) {
        // the figure grew (or the day rolled over): the row needs a different
        // number of wheels, so let React rebuild it and paint on the next frame
        setPlaces(need)
        setScale(nextScale)
        return
      }
      const units = Math.max(0, t) / scale
      let i = 0
      for (const el of Array.from(row.children)) {
        if (!el.classList.contains("wheel")) continue
        paintWheel(el, places - 1 - i, units)
        i += 1
      }
    },
  }), [places, scale])

  const row: React.ReactNode[] = []
  for (let i = 0; i < places; i++) {
    const exp = places - 1 - i
    row.push(<Wheel key={i} />)
    if (exp > 0 && exp % 3 === 0)
      row.push(<span key={"sep" + i} className="value shrink-0 text-[34px] leading-none text-muted-foreground/40">,</span>)
  }
  return (
    <div className="flex items-baseline" ref={rowRef}>
      {row}
      {scale > 1 && <span className="value shrink-0 pl-[4px] text-[20px] leading-none text-muted-foreground">{scale === 1e6 ? 'M' : 'K'}</span>}
    </div>
  )
})


// Preserve the geared wheel animation; chase only observed samples.
export function TokenCounter({ tokens }: { tokens: number }) {
  const ref = useRef<OdometerHandle>(null)
  const control = useRef({ target: tokens, shown: tokens })
  useEffect(() => {
    if (tokens < control.current.target) control.current.shown = tokens
    control.current.target = tokens
  }, [tokens])
  useEffect(() => {
    let frame = 0, last = performance.now()
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const step = (time: number) => {
      const dt = Math.min(0.5, (time - last) / 1000)
      last = time
      const c = control.current
      c.shown = reduced.matches ? c.target : c.shown + (c.target - c.shown) * (1 - Math.exp(-dt / 1.5))
      if (Math.abs(c.target - c.shown) < 1) c.shown = c.target
      ref.current?.paint(c.shown)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div className="token-counter" role="img" aria-label={`${Math.round(tokens).toLocaleString()} tokens today`}><Odometer ref={ref} tokens={tokens} /></div>
}
