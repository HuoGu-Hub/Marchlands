const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("marchlandsHost", {
  setSize: (width, height) => ipcRenderer.invoke("window:set-size", width, height),
  setFullscreen: (enabled) => ipcRenderer.invoke("window:set-fullscreen", enabled),
  saveMapFile: (text, name) => ipcRenderer.invoke("map:save", text, name),
  openMapFile: () => ipcRenderer.invoke("map:open"),
  quit: () => ipcRenderer.send("app:quit"),
});
