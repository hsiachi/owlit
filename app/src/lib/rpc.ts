// Typed client for core. In the desktop app every call goes over window.owlit (the Electron preload);
// in a browser (pnpm dev:web) over the web bridge to the dev core. Without either there is no core: calls
// fail with a readable error and the stores stay empty.

import { t } from "@lingui/core/macro"
import type {
  MethodName,
  NotificationName,
  Notifications,
  OwlitBridge,
  ParamsOf,
  ResultOf,
  RpcNotification,
} from "@owlit/protocol"
import { NO_CORE, webBridge, webFileUrl } from "./web-bridge"

declare global {
  interface Window {
    owlit?: OwlitBridge
  }
}

// The dev core pnpm dev:web serves, if any (scripts/dev-web.mjs sets it for Vite)
const devCore: string | undefined = import.meta.env.VITE_OWLIT_CORE

// The Electron preload's API, or its stand-in for the dev core; undefined in a plain browser
export const bridge = typeof window === "undefined" ? undefined : (window.owlit ?? (devCore ? webBridge(devCore) : undefined))

// What only the app's own window can do, not a browser tab on the dev core: show a file in the Finder
export const canReveal = typeof window !== "undefined" && window.owlit !== undefined

// Where the window reads a file of the workspace (a paper's PDF, a figure): owlit-file://workspace/<path>
// as core names it in the app, the dev core's http route in a browser
export const fileUrl = (url: string) => (devCore && !window.owlit ? webFileUrl(devCore, url) : url)

// Where a dropped or picked file is on disk, for core to read it
export function filePath(file: File) {
  const path = bridge?.pathForFile(file)
  if (!path) throw new Error(t`That file can't be read from here.`)
  return path
}

// An error core answered with. message is one sentence fit to show as is.
export class RpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "RpcError"
    this.code = code
    this.data = data
  }
}

type Args<M extends MethodName> = ParamsOf<M> extends void ? [] : [params: ParamsOf<M>]

export async function call<M extends MethodName>(method: M, ...args: Args<M>): Promise<ResultOf<M>> {
  if (!bridge) throw new RpcError(NO_CORE, t`This needs the owlit desktop app.`)
  const response = await bridge.rpc(method, args[0])
  if ("error" in response) throw new RpcError(response.error.code, response.error.message, response.error.data)
  return response.result as ResultOf<M>
}

type NamespaceOf<M> = M extends `${infer NS}.${string}` ? NS : never

type Client = {
  [NS in NamespaceOf<MethodName>]: {
    [M in MethodName as M extends `${NS}.${infer Verb}` ? Verb : never]: (...args: Args<M>) => Promise<ResultOf<M>>
  }
}

// rpc.core.ping() is call("core.ping")
export const rpc = new Proxy({} as Client, {
  get: (_, namespace) =>
    new Proxy(
      {},
      { get: (_, verb) => (params?: unknown) => (call as (m: string, p?: unknown) => unknown)(`${String(namespace)}.${String(verb)}`, params) },
    ),
})

type Listener = (payload: never) => void
const listeners = new Map<string, Set<Listener>>()

bridge?.onNotify((notification: RpcNotification) => {
  for (const listener of listeners.get(notification.method) ?? []) listener(notification.params as never)
})

// Hear one kind of notification from core; returns an unsubscribe. A no-op without a bridge.
export function onNotify<T extends NotificationName>(topic: T, listener: (payload: Notifications[T]) => void) {
  const set = listeners.get(topic) ?? new Set()
  set.add(listener as Listener)
  listeners.set(topic, set)
  return () => {
    set.delete(listener as Listener)
  }
}
