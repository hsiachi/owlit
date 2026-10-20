// The preload's stand-in for pnpm dev:web: window.owlit over a WebSocket to the dev core that
// scripts/dev-web.mjs serves (VITE_OWLIT_CORE names it). Core's RPC and notifications are the real ones;
// what only the window can give (a folder picker, a file's path, the menu) is stood in for or absent.

import type { OwlitBridge, RpcNotification, RpcResponse } from "@owlit/protocol"

// Not one of JSON-RPC's codes: the request never reached core
export const NO_CORE = -32099

// Where the dev core serves owlit-file://workspace/<path>: the same port, over http
export function webFileUrl(coreUrl: string, url: string) {
  return url.replace(/^owlit-file:\/\/workspace\//, `${coreUrl.replace(/^ws/, "http")}/workspace/`)
}

export function webBridge(coreUrl: string): OwlitBridge {
  const pending = new Map<number, (response: RpcResponse) => void>()
  const notified = new Set<(notification: RpcNotification) => void>()
  let nextId = 1
  let socket: WebSocket
  let open: Promise<void>
  let connected = false
  const connect = () => {
    socket = new WebSocket(coreUrl)
    open = new Promise((resolve) => socket.addEventListener("open", () => resolve()))
    socket.addEventListener("open", () => {
      // The dev core was restarted under a page that had loaded from the old one: start the page over,
      // so every store loads afresh (in the app, core never restarts without the window)
      if (connected) window.location.reload()
      connected = true
    })
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as RpcResponse | RpcNotification
      if ("id" in message) {
        pending.get(message.id as number)?.(message)
        pending.delete(message.id as number)
      } else for (const listener of notified) listener(message)
    })
    socket.addEventListener("close", () => {
      for (const [id, resolve] of pending) resolve({ jsonrpc: "2.0", id, error: { code: NO_CORE, message: "The dev core went away." } })
      pending.clear()
      setTimeout(connect, 1000)
    })
  }
  connect()

  const never = () => () => {}
  return {
    platform: /Mac/.test(navigator.userAgent) ? "darwin" : "other",
    rpc: async (method, params) => {
      await open
      const id = nextId++
      return new Promise((resolve) => {
        pending.set(id, resolve)
        socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
      })
    },
    onNotify: (listener) => {
      notified.add(listener)
      return () => notified.delete(listener)
    },
    // A browser never says where a file is on disk
    pathForFile: () => "",
    controlsRoom: 0,
    onControlsRoom: never,
    // Before the first frame only the system's are known; core's settings take over a moment later
    appearance: { theme: "system", tone: "warm", language: "system" },
    locale: "en",
    onMenu: never,
    // No app menu opens another folder behind the page
    onBeforeSwitch: never,
    chooseFolder: async (options) => window.prompt(options.title, options.defaultPath ?? "") || null,
    chooseFile: async () => null,
    textMenuAsk: () => {},
    onTextMenuAsk: never,
    notify: (notification) => console.info("[owlit] notification", notification),
    restartToUpdate: async () => {},
    onNotificationClick: never,
  }
}
