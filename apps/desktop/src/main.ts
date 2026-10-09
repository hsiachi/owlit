// Electron main process: wiring only. It makes windows, starts core and carries its messages; anything
// that is owlit's own logic lives in @owlit/core.

import { Core } from "@owlit/core"
import type { AppearanceSettings, DocsChange, MethodName, ParamsOf, ResultOf, RpcRequest, SettingsView, WorkspaceInfo } from "@owlit/protocol"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, safeStorage, shell, type MenuItemConstructorOptions } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createBrowserHost } from "./browser.ts"

// Set by scripts/dev.mjs: the renderer comes from Vite's dev server, with HMR
const devUrl = process.env.OWLIT_DEV_URL

// Another app data directory, for trying a first launch without touching the real one
if (process.env.OWLIT_USER_DATA) app.setPath("userData", path.resolve(process.env.OWLIT_USER_DATA))

// A packaged build serves the renderer from app://owlit/. A real origin (not file://) lets the router
// use ordinary paths; a route (a path without an extension) falls back to index.html.
const RENDERER_SCHEME = "app"
const rendererDir = path.join(__dirname, "renderer")

// owlit-file://workspace/<path> reads a file of the open workspace (a paper's PDF), served by core
const FILE_SCHEME = "owlit-file"

protocol.registerSchemesAsPrivileged([
  { scheme: RENDERER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
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

// ---- The window's frame. On macOS there is no title bar: the traffic lights sit in owlit's 40px top
// bar, centred on its middle line, and the bar leaves them room except in full screen, where they hide.

const isMac = process.platform === "darwin"
// The traffic lights' top-left corner, and how much of the top bar's left end they need
const TRAFFIC_LIGHTS = { x: 14, y: 13 }
const TRAFFIC_LIGHTS_ROOM = 78

const controlsRoom = (win: BrowserWindow) => (isMac && !win.isFullScreen() ? TRAFFIC_LIGHTS_ROOM : 0)

ipcMain.on("controls-room", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  event.returnValue = win ? controlsRoom(win) : 0
})

function followControls(win: BrowserWindow) {
  const tell = () => {
    if (!win.webContents.isDestroyed()) win.webContents.send("controls-room", controlsRoom(win))
  }
  win.on("enter-full-screen", tell)
  win.on("leave-full-screen", tell)
}

// ---- Appearance. The theme goes to nativeTheme, so the system's own drawing (scrollbars, menus) and
// prefers-color-scheme both follow it; the renderer reads theme and tone once, synchronously, before its
// first frame. The window's own background is the frame's colour, so nothing flashes while it loads.

let appearance: AppearanceSettings = { theme: "system", tone: "warm" }

ipcMain.on("appearance", (event) => {
  event.returnValue = appearance
})

// The frame colour (the sidebar token) of each tone, light and dark; app/src/index.css has the source
const FRAME: Record<AppearanceSettings["tone"], [light: string, dark: string]> = {
  warm: ["#eeebe7", "#0e0c0b"],
  neutral: ["#ececec", "#0c0c0c"],
  slate: ["#e6ecf3", "#090c11"],
  sepia: ["#efe7d8", "#120d09"],
}
const frameColor = () => FRAME[appearance.tone]?.[nativeTheme.shouldUseDarkColors ? 1 : 0] ?? FRAME.warm[0]

function applyAppearance(next: AppearanceSettings) {
  appearance = next
  nativeTheme.themeSource = next.theme
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(frameColor())
}
nativeTheme.on("updated", () => {
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(frameColor())
})

function createWindow() {
  const win = new BrowserWindow({
    backgroundColor: frameColor(),
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "owlit",
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: TRAFFIC_LIGHTS } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once("ready-to-show", () => win.show())
  // A link meant for a new window (a key's sign-up page, a paper's DOI) opens in the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  followControls(win)
  // The title is the workspace's name, not the page's <title>
  win.on("page-title-updated", (event) => event.preventDefault())
  if (current) showWorkspace(win, current)
  void win.loadURL(devUrl ?? `${RENDERER_SCHEME}://owlit/`)
  return win
}

// Core is transport-agnostic; here its requests ride ipcMain.handle and its notifications go to
// every window
function attachCore(core: Core) {
  ipcMain.handle("rpc", (_event, request: RpcRequest) => core.handle(request))
  protocol.handle(FILE_SCHEME, (request) => core.serveFile(request))
  core.onNotify((notification) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send("notify", notification)
    }
  })
}

// Main is one more client of core: it calls the same methods the renderer does
let requestId = 0
async function call<M extends MethodName>(core: Core, method: M, params?: ParamsOf<M>): Promise<ResultOf<M>> {
  const response = await core.handle({ jsonrpc: "2.0", id: `main-${++requestId}`, method, params })
  if ("error" in response) throw new Error(response.error.message)
  return response.result as ResultOf<M>
}

// ---- Workspace: which folder is open, the File menu, the window's title (not drawn on macOS, but used by
// Mission Control and the Window menu) ----

let current: WorkspaceInfo | null = null

function showWorkspace(win: BrowserWindow, info: WorkspaceInfo) {
  win.setTitle(info.name)
  // macOS: the folder's icon in the title bar, with its path on ⌘-click
  win.setRepresentedFilename(info.path)
}

async function openWorkspace(core: Core, folder: string) {
  try {
    await call(core, "workspace.open", { path: folder })
  } catch (error) {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = { type: "warning" as const, message: "Couldn't open the folder", detail: (error as Error).message }
    await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
    await updateMenu(core)
  }
}

async function chooseWorkspace(core: Core) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: "Open Workspace",
    message: "Choose the folder owlit works in. Your docs, library and notes live there.",
    buttonLabel: "Open",
    properties: ["openDirectory", "createDirectory"],
  }
  const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  if (!result.canceled && result.filePaths[0]) await openWorkspace(core, result.filePaths[0])
}

// Brings a pitta library into the open workspace, once; ~/.pitta is where pitta kept it
async function importPitta(core: Core) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: "Import a pitta Library",
    message: "Choose the pitta library (the folder that holds papers/). It is only read.",
    buttonLabel: "Import",
    defaultPath: path.join(app.getPath("home"), ".pitta"),
    properties: ["openDirectory", "showHiddenFiles"],
  }
  const chosen = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  if (chosen.canceled || !chosen.filePaths[0]) return
  let message: string
  let detail: string | undefined
  try {
    const { added, skipped, failed } = await call(core, "library.importPitta", { root: chosen.filePaths[0] })
    message = `${added} ${added === 1 ? "paper" : "papers"} imported`
    detail = [skipped && `${skipped} were already in the library.`, failed.length && `${failed.length} couldn't be read:\n${failed.join("\n")}`].filter(Boolean).join("\n\n") || undefined
  } catch (error) {
    message = "The pitta library couldn't be imported"
    detail = error instanceof Error ? error.message : String(error)
  }
  const box: Electron.MessageBoxOptions = { message, detail, buttons: ["OK"] }
  await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box))
}

async function updateMenu(core: Core) {
  const recent = await call(core, "workspace.recent").catch(() => [])
  const recentItems: MenuItemConstructorOptions[] = recent.map((info) => ({
    label: info.name,
    sublabel: info.path,
    click: () => void openWorkspace(core, info.path),
  }))
  const openSettings = () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send("menu", "settings")
  }
  const settingsItem: MenuItemConstructorOptions = { label: "Settings…", accelerator: "CmdOrCtrl+,", click: openSettings }
  const template: MenuItemConstructorOptions[] = [
    isMac
      ? {
          role: "appMenu",
          submenu: [
            { role: "about" },
            { type: "separator" },
            settingsItem,
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        }
      : { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "Open Workspace…", accelerator: "CmdOrCtrl+O", click: () => void chooseWorkspace(core) },
        {
          label: "Open Recent",
          submenu: [
            ...(recentItems.length ? recentItems : [{ label: "No Recent Workspaces", enabled: false }]),
            { type: "separator" },
            {
              label: "Clear Menu",
              enabled: recentItems.length > 0,
              click: async () => {
                await call(core, "workspace.clearRecent")
                app.clearRecentDocuments()
                await updateMenu(core)
              },
            },
          ],
        },
        { type: "separator" },
        { label: "Import a pitta Library…", enabled: !!current, click: () => void importPitta(core) },
        // Elsewhere the convention is File › Settings
        ...(isMac ? [] : [{ type: "separator" as const }, settingsItem]),
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- Start ----

// One owlit at a time: a second launch hands over to the first, which comes to the front
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    if (!devUrl) serveRenderer()
    const browser = createBrowserHost()
    const core = new Core({
      userDataDir: app.getPath("userData"),
      appVersion: app.getVersion(),
      debug: !app.isPackaged,
      // owlit-mcp and the CLI reach the open workspace here
      socket: true,
      // owlit-mcp, bundled beside main, run by Electron's own binary as plain Node
      mcp: { command: process.execPath, args: [path.join(__dirname, "owlit-mcp.cjs")], env: { ELECTRON_RUN_AS_NODE: "1" } },
      // Copied beside main by scripts/shared.mjs
      pdfiumWasm: path.join(__dirname, "pdfium.wasm"),
      host: {
        // Chromium's network stack: the system proxy and certificates, which Node's fetch ignores
        fetch: (input, init) => net.fetch(input as string, init),
        // A hidden window for publishers that want a real browser (cookies, checks, the library proxy)
        browser,
        // Keys in settings.json are sealed with the system keychain (macOS Keychain, DPAPI, libsecret)
        secrets: {
          seal: (plain) => {
            if (!safeStorage.isEncryptionAvailable()) throw new Error("The system keychain isn't available.")
            return safeStorage.encryptString(plain).toString("base64")
          },
          open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, "base64")),
        },
        trash: (file) => shell.trashItem(file),
        openPath: async (file) => {
          const failure = await shell.openPath(file)
          if (failure) throw new Error(failure)
        },
      },
    })
    attachCore(core)
    // Development aid: print every activity event the renderer reports
    if (process.env.OWLIT_LOG_ACTIVITY) core.activity.subscribe((event) => console.log("[activity]", JSON.stringify(event)))
    // Development aid: print what the workspace watcher reports (paths only, not text)
    if (process.env.OWLIT_LOG_DOCS) {
      core.onNotify(({ method, params }) => {
        if (method !== "docs.changed") return
        const change = params as DocsChange
        console.log("[docs.changed]", JSON.stringify({ ...change, changed: change.changed.map((f) => f.path) }))
      })
    }
    core.onNotify((notification) => {
      if (notification.method !== "workspace.opened") return
      current = notification.params as WorkspaceInfo
      for (const win of BrowserWindow.getAllWindows()) showWorkspace(win, current)
      app.addRecentDocument(current.path)
      void updateMenu(core)
    })
    core.onNotify((notification) => {
      if (notification.method === "settings.changed") applyAppearance((notification.params as SettingsView).appearance)
    })
    applyAppearance((await core.settings.get()).appearance)
    await updateMenu(core)

    const win = createWindow()
    // The first window is listening once it has loaded; that is when core says hello
    win.webContents.once("did-finish-load", () => core.start())

    // Reopen the last workspace; on a first launch (or when it is gone) ask for a folder
    const last = await core.lastWorkspace()
    if (last) await openWorkspace(core, last)
    else if (win.isVisible()) void chooseWorkspace(core)
    else win.once("show", () => void chooseWorkspace(core))

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    let disposed = false
    app.on("will-quit", (event) => {
      if (disposed) return
      // Let core release the workspace lock before the process ends
      event.preventDefault()
      disposed = true
      void core.dispose().finally(() => app.quit())
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}
