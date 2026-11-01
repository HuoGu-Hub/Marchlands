const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("marchlandsHost", {
  setSize: (width, height) => ipcRenderer.invoke("window:set-size", width, height),
  setFullscreen: (enabled) => ipcRenderer.invoke("window:set-fullscreen", enabled),
  quit: () => ipcRenderer.send("app:quit"),
});
