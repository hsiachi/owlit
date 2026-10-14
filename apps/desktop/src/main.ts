// Electron main process: wiring only. It makes windows, starts core and carries its messages; anything
// that is owlit's own logic lives in @owlit/core.

import { plural, t } from "@lingui/core/macro"
import { Core } from "@owlit/core"
import { activateLocale } from "@owlit/i18n"
import { CATALOGS } from "@owlit/i18n/catalogs"
import { interfaceLocale, type AppearanceSettings, type DocsChange, type Locale, type MenuCommand, type MethodName, type ParamsOf, type ResultOf, type RpcRequest, type SettingsView, type WorkspaceInfo } from "@owlit/protocol"
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, Notification, protocol, safeStorage, session, shell, type MenuItemConstructorOptions } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createBrowserHost } from "./browser.ts"
import { installCliTool, writeCliScript } from "./cli-tool.ts"
import { attachTextMenu } from "./text-menu.ts"

// The share server named at build time (scripts/shared.mjs); "" when none was
declare const __OWLIT_SHARE_SERVER__: string

// Set by scripts/dev.mjs: the renderer comes from Vite's dev server, with HMR
const devUrl = process.env.OWLIT_DEV_URL

// Another app data directory, for trying a first launch without touching the real one
if (process.env.OWLIT_USER_DATA) app.setPath("userData", path.resolve(process.env.OWLIT_USER_DATA))

// Chromium stops drawing a window macOS reports as covered, and after the lid opens again macOS may never
// say it is uncovered: the page stayed still while a reply ran on behind it, until the user switched away
// and back. owlit has one window, so it keeps drawing while covered; a hidden or minimised one still stops.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")

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

let appearance: AppearanceSettings = { theme: "system", tone: "warm", language: "system" }

// The interface's language: main's own words (menus, dialogs) and core's messages, which run in this
// process, follow it; the renderer reads it once, synchronously, before its first frame
let locale: Locale = interfaceLocale("system", app.getPreferredSystemLanguages())
activateLocale(locale, CATALOGS[locale])

ipcMain.on("locale", (event) => {
  event.returnValue = locale
})

// The system folder picker, for the welcome page's Open a folder you have, Choose… and Locate…
ipcMain.handle("choose-folder", async (event, options: { title: string; message?: string; buttonLabel?: string; defaultPath?: string }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const dialogOptions: Electron.OpenDialogOptions = { ...options, properties: ["openDirectory", "createDirectory"] }
  const result = await (win ? dialog.showOpenDialog(win, dialogOptions) : dialog.showOpenDialog(dialogOptions))
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

ipcMain.handle("choose-file", async (event, options: { title: string; message?: string; buttonLabel?: string; extensions: string[] }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { extensions, ...rest } = options
  const dialogOptions: Electron.OpenDialogOptions = { ...rest, properties: ["openFile"], filters: [{ name: extensions.join(", "), extensions }] }
  const result = await (win ? dialog.showOpenDialog(win, dialogOptions) : dialog.showOpenDialog(dialogOptions))
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

ipcMain.on("appearance", (event) => {
  event.returnValue = appearance
})

// A chat that waits on the user or broke, said by the system while no owlit window is in front (the app
// often runs in another Space). Clicking it brings the window back and opens the chat.
const shown = new Set<Notification>()
ipcMain.on("notify", (event, n: { title: string; body: string; chatId: string }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
  const notification = new Notification({ title: n.title, body: n.body })
  // Kept until it is clicked or closed, or the click would find nothing listening
  shown.add(notification)
  notification.on("click", () => {
    shown.delete(notification)
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send("notification-click", n.chatId)
  })
  notification.on("close", () => shown.delete(notification))
  notification.show()
})

// The frame colour (the sidebar token) of each tone, light and dark; app/src/index.css has the source
const FRAME: Record<AppearanceSettings["tone"], [light: string, dark: string]> = {
  warm: ["#edece7", "#0d0c0a"],
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
    title: "Owlit",
    ...(isMac ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: TRAFFIC_LIGHTS } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once("ready-to-show", () => win.show())
  attachTextMenu(win)
  // A link meant for a new window (a key's sign-up page, a paper's DOI) opens in the user's browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    // A relative link resolves to owlit's own page (the dev server's address is a web one): never the browser's
    if (/^https?:\/\//.test(url) && !isOwnPage(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  // The window only ever shows owlit's own page: anything else would get the preload's bridge to core
  // (a dropped link, a link an agent wrote). Web links go to the user's browser instead.
  win.webContents.on("will-navigate", (event, url) => {
    if (isOwnPage(url)) return
    event.preventDefault()
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
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
  ipcMain.handle("rpc", (event, request: RpcRequest) => {
    if (!isOwnPage(event.senderFrame?.url ?? "")) throw new Error("Only Owlit's own page may call core.")
    return core.handle(request)
  })
  protocol.handle(FILE_SCHEME, (request) => core.serveFile(request))
  core.onNotify((notification) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send("notify", notification)
    }
  })
}

// owlit's renderer: Vite's dev server in development, the app scheme otherwise
function isOwnPage(url: string) {
  try {
    // protocol and host, not origin: a custom scheme's origin is "null"
    const at = new URL(url)
    const own = new URL(devUrl ?? `${RENDERER_SCHEME}://owlit/`)
    return at.protocol === own.protocol && at.host === own.host
  } catch {
    return false
  }
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
    const options = { type: "warning" as const, message: t`Couldn't open the folder`, detail: (error as Error).message }
    await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
    await updateMenu(core)
  }
}

async function chooseWorkspace(core: Core) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: t`Open Workspace`,
    message: t`Choose the folder Owlit works in. Your docs, library and notes live there.`,
    buttonLabel: t`Open`,
    properties: ["openDirectory", "createDirectory"],
  }
  const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  if (!result.canceled && result.filePaths[0]) await openWorkspace(core, result.filePaths[0])
}

// Brings a pitta library into the open workspace, once; ~/.pitta is where pitta kept it
async function importPitta(core: Core) {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const options: Electron.OpenDialogOptions = {
    title: t`Import a pitta Library`,
    message: t`Choose the pitta library (the folder that holds papers/). It is only read.`,
    buttonLabel: t`Import`,
    defaultPath: path.join(app.getPath("home"), ".pitta"),
    properties: ["openDirectory", "showHiddenFiles"],
  }
  const chosen = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  if (chosen.canceled || !chosen.filePaths[0]) return
  let message: string
  let detail: string | undefined
  try {
    const { added, skipped, failed } = await call(core, "library.importPitta", { root: chosen.filePaths[0] })
    message = plural(added, { one: "# paper imported", other: "# papers imported" })
    const failedCount = failed.length
    detail =
      [
        skipped && plural(skipped, { one: "# was already in the library.", other: "# were already in the library." }),
        failedCount && `${t`${failedCount} couldn't be read:`}\n${failed.join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n") || undefined
  } catch (error) {
    message = t`The pitta library couldn't be imported`
    detail = error instanceof Error ? error.message : String(error)
  }
  const box: Electron.MessageBoxOptions = { message, detail, buttons: [t`OK`] }
  await (win ? dialog.showMessageBox(win, box) : dialog.showMessageBox(box))
}

async function updateMenu(core: Core) {
  const recent = await call(core, "workspace.recent").catch(() => [])
  const recentItems: MenuItemConstructorOptions[] = recent.map((info) => ({
    label: info.name,
    sublabel: info.path,
    click: () => void openWorkspace(core, info.path),
  }))
  const send = (command: MenuCommand) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    win?.webContents.send("menu", command)
  }
  const settingsItem: MenuItemConstructorOptions = { label: t`Settings…`, accelerator: "CmdOrCtrl+,", click: () => send("settings") }
  const name = app.name
  // Electron names its role items in English only, so each one carries its label in the interface's
  // language; the items and their order are Electron's own defaults
  const template: MenuItemConstructorOptions[] = [
    isMac
      ? {
          role: "appMenu",
          label: name,
          submenu: [
            { role: "about", label: t`About ${name}` },
            { type: "separator" },
            settingsItem,
            { label: t`Install Command Line Tool…`, click: () => void installCliTool() },
            { type: "separator" },
            { role: "services", label: t`Services` },
            { type: "separator" },
            { role: "hide", label: t`Hide ${name}` },
            { role: "hideOthers", label: t`Hide Others` },
            { role: "unhide", label: t`Show All` },
            { type: "separator" },
            { role: "quit", label: t`Quit ${name}` },
          ],
        }
      : { role: "appMenu" },
    {
      label: t`File`,
      submenu: [
        { label: t`Open Workspace…`, accelerator: "CmdOrCtrl+O", click: () => void chooseWorkspace(core) },
        {
          label: t`Open Recent`,
          submenu: [
            ...(recentItems.length ? recentItems : [{ label: t`No Recent Workspaces`, enabled: false }]),
            { type: "separator" },
            {
              label: t`Clear Menu`,
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
        { label: t`Import Papers…`, enabled: !!current, click: () => send("import") },
        { label: t`Import a pitta Library…`, enabled: !!current, click: () => void importPitta(core) },
        // Elsewhere the convention is File › Settings
        ...(isMac ? [] : [{ type: "separator" as const }, settingsItem]),
        { type: "separator" },
        { role: "close", label: t`Close Window` },
      ],
    },
    {
      role: "editMenu",
      label: t`Edit`,
      submenu: [
        { role: "undo", label: t`Undo` },
        { role: "redo", label: t`Redo` },
        { type: "separator" },
        { role: "cut", label: t`Cut` },
        { role: "copy", label: t`Copy` },
        { role: "paste", label: t`Paste` },
        ...(isMac
          ? ([
              { role: "pasteAndMatchStyle", label: t`Paste and Match Style` },
              { role: "delete", label: t`Delete` },
              { role: "selectAll", label: t`Select All` },
              { type: "separator" },
              {
                label: t`Speech`,
                submenu: [
                  { role: "startSpeaking", label: t`Start Speaking` },
                  { role: "stopSpeaking", label: t`Stop Speaking` },
                ],
              },
            ] satisfies MenuItemConstructorOptions[])
          : ([{ role: "delete", label: t`Delete` }, { type: "separator" }, { role: "selectAll", label: t`Select All` }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      role: "viewMenu",
      label: t`View`,
      submenu: [
        { role: "reload", label: t`Reload` },
        { role: "forceReload", label: t`Force Reload` },
        { role: "toggleDevTools", label: t`Toggle Developer Tools` },
        { type: "separator" },
        { role: "resetZoom", label: t`Actual Size` },
        { role: "zoomIn", label: t`Zoom In` },
        { role: "zoomOut", label: t`Zoom Out` },
        { type: "separator" },
        { role: "togglefullscreen", label: t`Toggle Full Screen` },
      ],
    },
    {
      role: "windowMenu",
      label: t`Window`,
      submenu: [
        { role: "minimize", label: t`Minimize` },
        { role: "zoom", label: t`Zoom` },
        ...(isMac
          ? ([{ type: "separator" }, { role: "front", label: t`Bring All to Front` }] satisfies MenuItemConstructorOptions[])
          : ([{ role: "close", label: t`Close` }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    {
      role: "help",
      label: t`Help`,
      submenu: [
        // The tour runs in the example workspace, which it opens when another one is open
        { label: t`Take the Tour`, click: () => send("tour") },
        // The first launch's four introduction steps again, over the app
        { label: t`How owlit Works`, enabled: !!current, click: () => send("intro") },
        { type: "separator" },
        { label: t`Keyboard Shortcuts`, accelerator: "CmdOrCtrl+/", click: () => send("shortcuts") },
        // Owlit answers questions about owlit itself; it needs a workspace to run in
        { label: t`Ask Owlit How To…`, enabled: !!current, click: () => send("how-to") },
        { type: "separator" },
        { label: t`Copy Diagnostics`, click: () => send("diagnostics") },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---- Start ----

// The system proxy as HTTPS_PROXY, for the engine's model requests: an app started from Finder has no
// proxy in its environment, and Node's fetch only uses one from there. Read once at launch.
async function systemProxy(): Promise<Record<string, string>> {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) return {}
  const rule = (await session.defaultSession.resolveProxy("https://api.openai.com")).split(";")[0].trim()
  const proxy = /^(PROXY|HTTPS) (\S+)$/.exec(rule)
  return proxy ? { HTTPS_PROXY: `${proxy[1] === "HTTPS" ? "https" : "http"}://${proxy[2]}` } : {}
}

// One owlit at a time: a second launch hands over to the first, which comes to the front
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A folder handed to the app (open -a Owlit <folder>, which `owlit open` runs; the Dock's recent
  // workspaces) opens as the workspace. One handed over while starting takes the last workspace's place.
  let handed: string | null = null
  let openHanded: ((folder: string) => void) | null = null
  app.on("open-file", (event, file) => {
    event.preventDefault()
    if (openHanded) openHanded(file)
    else handed = file
  })

  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    if (!devUrl) serveRenderer()
    // A packaged app gets its icon from the bundle; a dev run is Electron's own binary, so set it here
    if (isMac && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, "../resources/icon.png"))
    const browser = createBrowserHost()
    const core = new Core({
      userDataDir: app.getPath("userData"),
      appVersion: app.getVersion(),
      debug: !app.isPackaged,
      // owlit-mcp and the CLI reach the open workspace here
      socket: true,
      // owlit-mcp, bundled beside main, run by Electron's own binary as plain Node
      mcp: { command: process.execPath, args: [path.join(__dirname, "owlit-mcp.cjs")], env: { ELECTRON_RUN_AS_NODE: "1" } },
      // The Owlit engine (Beta), owlit's own agent, run the same way
      engine: { command: process.execPath, args: [path.join(__dirname, "owlit-agent.cjs")], env: { ELECTRON_RUN_AS_NODE: "1", ...(await systemProxy()) } },
      // Claude Code's and Codex's adapters, set up by owlit with its own npm and run the same way. A
      // packaged app keeps npm outside the asar archive (asarUnpack), since npm runs its own scripts.
      node: { command: process.execPath, args: [], env: { ELECTRON_RUN_AS_NODE: "1", ...(await systemProxy()) } },
      npm: path.join(__dirname.replace(/app\.asar(?=[/\\]|$)/, "app.asar.unpacked"), "npm", "bin", "npm-cli.js"),
      // Copied beside main by scripts/shared.mjs
      pdfiumWasm: path.join(__dirname, "pdfium.wasm"),
      // Where doc links are made (apps/share-server); none means docs can't be shared yet
      shareServer: process.env.OWLIT_SHARE_SERVER || __OWLIT_SHARE_SERVER__ || undefined,
      exampleDir: path.join(__dirname, "example-workspace"),
      host: {
        // Chromium's network stack: the system proxy and certificates, which Node's fetch ignores
        fetch: (input, init) => net.fetch(input as string, init),
        // A browser for publishers that want one (cookies, checks, the library proxy): hidden, or inside
        // the window when the user asks to see the page
        browser,
        // Keys in settings.json are sealed with the system keychain (macOS Keychain, DPAPI, libsecret)
        secrets: {
          seal: (plain) => {
            if (!safeStorage.isEncryptionAvailable()) throw new Error("The system keychain isn't available.")
            return safeStorage.encryptString(plain).toString("base64")
          },
          open: (sealed) => safeStorage.decryptString(Buffer.from(sealed, "base64")),
        },
        // The order set in System Settings › Language & Region, which digests follow by default
        languages: () => app.getPreferredSystemLanguages(),
        trash: (file) => shell.trashItem(file),
        openPath: async (file) => {
          const failure = await shell.openPath(file)
          if (failure) throw new Error(failure)
        },
        revealPath: (file) => shell.showItemInFolder(file),
        // OWLIT_NO_EXTERNAL (tests): say where it would go instead of opening the user's browser
        openExternal: async (url, options) => {
          if (process.env.OWLIT_NO_EXTERNAL) console.log("[open-external]", options?.background ? "(background)" : "", url)
          else await shell.openExternal(url, { activate: !options?.background })
        },
        // The app that opens web pages: its name, and the app itself brought to the front as it is
        // (its last tab, where a page may be asking something), not a new page
        browserName: async () => (await app.getApplicationInfoForProtocol("https://")).name.replace(/\.app$/, "") || undefined,
        showBrowser: async () => {
          const browser = await app.getApplicationInfoForProtocol("https://")
          if (process.env.OWLIT_NO_EXTERNAL) return console.log("[show-browser]", browser.path)
          const failure = await shell.openPath(browser.path)
          if (failure) throw new Error(failure)
        },
        // OWLIT_DOWNLOADS (tests): another folder in place of the user's Downloads
        downloadsDir: () => process.env.OWLIT_DOWNLOADS ?? app.getPath("downloads"),
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
    const applySettings = (view: SettingsView) => {
      applyAppearance(view.appearance)
      if (view.locale === locale) return false
      locale = view.locale
      activateLocale(locale, CATALOGS[locale])
      return true
    }
    core.onNotify((notification) => {
      if (notification.method === "settings.changed" && applySettings(notification.params as SettingsView)) void updateMenu(core)
    })
    applySettings(await call(core, "settings.get"))
    await updateMenu(core)

    // Reopen the last workspace. It starts opening before the window loads, so the window waits for it
    // instead of showing the welcome page; on a first launch, or when the folder is gone, the window
    // shows the welcome page.
    const last = handed ?? (await core.lastWorkspace())
    if (last) void openWorkspace(core, last)
    openHanded = (folder) => void openWorkspace(core, folder)
    // The owlit command's script, pointing at this copy of the app
    void writeCliScript(path.join(__dirname, "owlit.cjs")).catch((error) => console.error("[cli] couldn't write the owlit script:", error))

    const win = createWindow()
    // The first window is listening once it has loaded; that is when core says hello
    win.webContents.once("did-finish-load", () => core.start())

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
