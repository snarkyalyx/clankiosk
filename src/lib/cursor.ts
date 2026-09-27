/* The kiosk is a wall panel, so a parked pointer should not sit on the
   dashboard. The cursor is hidden by default and comes back for a moment
   whenever the pointer or keyboard is actually used, so the screen stays
   operable without leaving an arrow parked in the middle of it. */
const HIDDEN = "cursor-idle"

const EVENTS: string[] = [
  "mousemove",
  "mousedown",
  "mouseup",
  "wheel",
  "keydown",
  "touchstart",
]

export function installIdleCursor(idleMs = 2500): () => void {
  const root = document.documentElement
  let timer = 0

  const hide = () => {
    window.clearTimeout(timer)
    timer = 0
    root.classList.add(HIDDEN)
  }

  const show = () => {
    window.clearTimeout(timer)
    root.classList.remove(HIDDEN)
    timer = window.setTimeout(hide, idleMs)
  }

  const listener = show as EventListener
  for (const type of EVENTS) window.addEventListener(type, listener, { passive: true })

  // nothing shows until the pointer is actually used
  hide()

  return () => {
    window.clearTimeout(timer)
    for (const type of EVENTS) window.removeEventListener(type, listener)
    root.classList.remove(HIDDEN)
  }
}
