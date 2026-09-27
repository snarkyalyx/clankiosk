/// <reference types="vite/client" />

declare module "*.css"

export {}

declare global {
  interface Window {
    kiosk?: {
      getData: () => Promise<import("./types").KioskData>
      onData: (cb: (d: import("./types").KioskData) => void) => () => void
      onTick?: (cb: (t: import("./types").KioskTick) => void) => () => void
    }
  }
}
