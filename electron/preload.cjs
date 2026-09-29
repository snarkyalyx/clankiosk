const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("kiosk", {
  getData: () => ipcRenderer.invoke("kiosk:get-data"),
  getSetup: () => ipcRenderer.invoke("kiosk:get-setup"),
  saveSetup: (selection) => ipcRenderer.invoke("kiosk:save-setup", selection),
  onSetup: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('kiosk:show-setup', listener)
    return () => ipcRenderer.removeListener('kiosk:show-setup', listener)
  },
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
