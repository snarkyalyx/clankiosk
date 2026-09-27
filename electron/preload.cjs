const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kiosk", {
  getData: () => ipcRenderer.invoke("kiosk:get-data"),
  onData: (cb) => {
    const listener = (_e, d) => cb(d)
    ipcRenderer.on("kiosk:data", listener)
    return () => ipcRenderer.removeListener("kiosk:data", listener)
  },
  // once-a-second token tick (live odometer source)
  onTick: (cb) => {
    const listener = (_e, d) => cb(d)
    ipcRenderer.on("kiosk:tick", listener)
    return () => ipcRenderer.removeListener("kiosk:tick", listener)
  },
})
