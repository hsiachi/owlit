// A stand-in for the Electron preload (window.owlit) in the renderer's unit tests: it records every call,
// answers with what a test set for the method, and sends notifications as core would. lib/rpc.ts reads
// window.owlit once, when it is first imported, so a test imports this module before any other.

import type { MethodName, NotificationName, Notifications, OwlitBridge, ParamsOf, ResultOf, RpcNotification, RpcResponse, WorkspaceInfo } from "@owlit/protocol"

type Answer<M extends MethodName> = (params: ParamsOf<M>) => ResultOf<M> | Promise<ResultOf<M>>

const answers = new Map<string, (params: never) => unknown>()
const listeners = new Set<(notification: RpcNotification) => void>()

// Every request in the order it was sent
export const calls: { method: string; params: unknown }[] = []

export const callsTo = (method: MethodName) => calls.filter((c) => c.method === method)

// How core answers method from now on; a method without an answer resolves with null
export function answer<M extends MethodName>(method: M, respond: Answer<M>) {
  answers.set(method, respond as (params: never) => unknown)
}

export function notify<T extends NotificationName>(method: T, params: Notifications[T]) {
  for (const listener of listeners) listener({ jsonrpc: "2.0", method, params })
}

// Core says a workspace is open; startWorkspace() must have run for the window to hear it
export function openedWorkspace(path: string) {
  notify("workspace.opened", { path, name: path.split("/").pop() ?? path } as WorkspaceInfo)
}

// A promise a test resolves when it wants, to hold an answer back
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const bridge = {
  platform: "darwin",
  async rpc(method: string, params?: unknown): Promise<RpcResponse> {
    calls.push({ method, params })
    try {
      const respond = answers.get(method)
      return { jsonrpc: "2.0", id: calls.length, result: respond ? await respond(params as never) : null }
    } catch (error) {
      return { jsonrpc: "2.0", id: calls.length, error: { code: -32000, message: String(error) } }
    }
  },
  onNotify(listener: (notification: RpcNotification) => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  pathForFile: () => "",
  onBeforeSwitch(flush: () => Promise<unknown>) {
    beforeSwitch = flush
    return () => {
      beforeSwitch = undefined
    }
  },
} as unknown as OwlitBridge

let beforeSwitch: (() => Promise<unknown>) | undefined

// Main asks the window to flush before it opens another folder from the File menu
export const menuSwitch = () => beforeSwitch?.()

// Stores kept with zustand's persist write to window.localStorage on every change, even in the desktop app
const kept = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => kept.get(key) ?? null,
  setItem: (key: string, value: string) => void kept.set(key, value),
  removeItem: (key: string) => void kept.delete(key),
}

// A light system appearance that never changes, for the stores that follow it
const matchMedia = (media: string) => Object.assign(new EventTarget(), { media, matches: false })

// The window the modules under test see: events (pagehide), the bridge, localStorage and matchMedia
const fakeWindow = Object.assign(new EventTarget(), { owlit: bridge, localStorage, matchMedia })
;(globalThis as { window?: unknown }).window = fakeWindow

export const pageHide = () => fakeWindow.dispatchEvent(new Event("pagehide"))
