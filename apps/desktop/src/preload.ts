// Preload: the only bridge between the sandboxed renderer and the main process. It exposes a narrow
// window.owlit (OwlitBridge) and nothing else.

import type { MenuCommand, OwlitBridge, RpcNotification, RpcResponse } from "@owlit/protocol"
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron"

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
  pathForFile: (file) => webUtils.getPathForFile(file as File),
  // Asked once, synchronously, so the first frame already leaves the right room
  controlsRoom: ipcRenderer.sendSync("controls-room") as number,
  chooseFolder: (options) => ipcRenderer.invoke("choose-folder", options) as Promise<string | null>,
  chooseFile: (options) => ipcRenderer.invoke("choose-file", options) as Promise<string | null>,
  onControlsRoom(listener) {
    const forward = (_event: IpcRendererEvent, room: number) => listener(room)
    ipcRenderer.on("controls-room", forward)
    return () => {
      ipcRenderer.off("controls-room", forward)
    }
  },
  // Asked once, synchronously, so the first frame is drawn in the chosen theme and tone
  appearance: ipcRenderer.sendSync("appearance"),
  // And the interface's language, so the first frame already speaks it
  locale: ipcRenderer.sendSync("locale"),
  textMenuAsk: (ask) => ipcRenderer.sendSync("text-menu-ask", ask),
  onTextMenuAsk(listener) {
    const forward = () => listener()
    ipcRenderer.on("text-menu-ask", forward)
    return () => {
      ipcRenderer.off("text-menu-ask", forward)
    }
  },
  notify: (notification) => ipcRenderer.send("notify", notification),
  onNotificationClick(listener) {
    const forward = (_event: IpcRendererEvent, chatId: string) => listener(chatId)
    ipcRenderer.on("notification-click", forward)
    return () => {
      ipcRenderer.off("notification-click", forward)
    }
  },
  onMenu(listener) {
    const forward = (_event: IpcRendererEvent, command: MenuCommand) => listener(command)
    ipcRenderer.on("menu", forward)
    return () => {
      ipcRenderer.off("menu", forward)
    }
  },
}

contextBridge.exposeInMainWorld("owlit", bridge)
