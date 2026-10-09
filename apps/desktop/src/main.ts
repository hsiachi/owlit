// Electron main process: wiring only. It makes windows, starts core and carries its messages; anything
// that is owlit's own logic lives in @owlit/core.

import { app, BrowserWindow, net, protocol } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"

// Set by scripts/dev.mjs: the renderer comes from Vite's dev server, with HMR
const devUrl = process.env.OWLIT_DEV_URL

// A packaged build serves the renderer from app://owlit/. A real origin (not file://) lets the router
// use ordinary paths; a route (a path without an extension) falls back to index.html.
const RENDERER_SCHEME = "app"
const rendererDir = path.join(__dirname, "renderer")

protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

function serveRenderer() {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const file = path.normalize(path.join(rendererDir, decodeURIComponent(pathname)))
    if (!file.startsWith(rendererDir)) return new Response(null, { status: 403 })
    const response = await net.fetch(pathToFileURL(file).toString()).catch(() => null)
    if (response?.ok) return response
    if (path.extname(pathname)) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path.join(rendererDir, "index.html")).toString())
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "owlit",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once("ready-to-show", () => win.show())
  void win.loadURL(devUrl ?? `${RENDERER_SCHEME}://owlit/`)
  return win
}

app.whenReady().then(() => {
  if (!devUrl) serveRenderer()
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
