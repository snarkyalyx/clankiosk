/// <reference types="vite/client" />

declare module "*.css"

export {}

declare global {
  interface Window {
    kiosk?: {
      getData: () => Promise<import("./types").KioskData>
      getSetup?: () => Promise<import("./types").SetupInfo>
      saveSetup?: (selection: import("./types").SetupChoices) => Promise<boolean>
      onSetup?: (cb: () => void) => () => void
      onData: (cb: (d: import("./types").KioskData) => void) => () => void
      onTick?: (cb: (t: import("./types").KioskTick) => void) => () => void
    }
  }
}
