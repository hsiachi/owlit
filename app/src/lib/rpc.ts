// Typed client for core. In the desktop app every call goes over window.owlit (the Electron preload);
// in a plain browser (pnpm dev:web) there is no core, calls fail with a readable error and the
// feature stores keep running on their mock data.

import type {
  MethodName,
  NotificationName,
  Notifications,
  OwlitBridge,
  ParamsOf,
  ResultOf,
  RpcNotification,
} from "@owlit/protocol"

declare global {
  interface Window {
    owlit?: OwlitBridge
  }
}

// The Electron preload's API; undefined in a plain browser
export const bridge = typeof window === "undefined" ? undefined : window.owlit

export const isDesktop = bridge !== undefined

// Where a dropped or picked file is on disk, for core to read it
export function filePath(file: File) {
  const path = bridge?.pathForFile(file)
  if (!path) throw new Error("That file can't be read from here.")
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

// Not one of JSON-RPC's codes: the request never left the renderer
const NO_CORE = -32099

type Args<M extends MethodName> = ParamsOf<M> extends void ? [] : [params: ParamsOf<M>]

export async function call<M extends MethodName>(method: M, ...args: Args<M>): Promise<ResultOf<M>> {
  if (!bridge) throw new RpcError(NO_CORE, "This needs the owlit desktop app.")
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

// Hear one kind of notification from core; returns an unsubscribe. A no-op without the desktop app.
export function onNotify<T extends NotificationName>(topic: T, listener: (payload: Notifications[T]) => void) {
  const set = listeners.get(topic) ?? new Set()
  set.add(listener as Listener)
  listeners.set(topic, set)
  return () => {
    set.delete(listener as Listener)
  }
}
