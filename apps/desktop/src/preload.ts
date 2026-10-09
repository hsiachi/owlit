// Preload: the only bridge between the sandboxed renderer and the main process. It exposes a narrow
// window.owlit (OwlitBridge) and nothing else.

import type { OwlitBridge, RpcNotification, RpcResponse } from "@owlit/protocol"
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

let nextId = 1

const bridge: OwlitBridge = {
  platform: process.platform,
  rpc: (method, params) =>
    ipcRenderer.invoke("rpc", { jsonrpc: "2.0", id: nextId++, method, params }) as Promise<RpcResponse>,
  onNotify(listener) {
    const forward = (_event: IpcRendererEvent, notification: RpcNotification) => listener(notification)
    ipcRenderer.on("notify", forward)
    return () => {
      ipcRenderer.off("notify", forward)
    }
  },
}

contextBridge.exposeInMainWorld("owlit", bridge)
