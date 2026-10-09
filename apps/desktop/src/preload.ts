// Preload: the only bridge between the sandboxed renderer and the main process. It exposes a narrow
// window.owlit and nothing else.

import { contextBridge } from "electron"

contextBridge.exposeInMainWorld("owlit", {
  platform: process.platform,
})
