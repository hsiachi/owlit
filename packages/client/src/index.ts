// A Node client for a running owlit: connects to the socket of an open workspace and speaks the same
// typed JSON-RPC the window does. owlit-mcp and the CLI are built on it.

import type { MethodName, NotificationName, Notifications, ParamsOf, ResultOf, RpcNotification, RpcResponse } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

// owlit isn't running with that workspace open (or the socket can't be reached)
export class OwlitNotRunning extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OwlitNotRunning"
  }
}

// An error owlit answered with; message is one sentence fit to show as is
export class OwlitError extends Error {
  readonly code: number
  readonly data?: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "OwlitError"
    this.code = code
    this.data = data
  }
}

type Args<M extends MethodName> = ParamsOf<M> extends void ? [] : [params: ParamsOf<M>]
type NamespaceOf<M> = M extends `${infer NS}.${string}` ? NS : never
type Rpc = {
  [NS in NamespaceOf<MethodName>]: {
    [M in MethodName as M extends `${NS}.${infer Verb}` ? Verb : never]: (...args: Args<M>) => Promise<ResultOf<M>>
  }
}

export interface OwlitClient {
  // The workspace's real path
  workspace: string
  call<M extends MethodName>(method: M, ...args: Args<M>): Promise<ResultOf<M>>
  // client.rpc.library.list() is client.call("library.list")
  rpc: Rpc
  // Hears one kind of notification; returns an unsubscribe
  on<T extends NotificationName>(topic: T, listener: (payload: Notifications[T]) => void): () => void
  close(): void
}

// Where a workspace's socket and its pointer are: the user's temp folder, named by the sha1 of the
// workspace's real path (as core names them)
export function socketPaths(workspace: string, dir = tmpdir()) {
  const hash = createHash("sha1").update(workspace.normalize("NFC")).digest("hex").slice(0, 12)
  return { socket: path.join(dir, `owlit-${hash}.sock`), pointer: path.join(dir, `owlit-${hash}.json`) }
}

// session: the secret core gave the owlit-mcp it started for an agent session (OWLIT_SESSION in its
// environment, read here when not given). Core takes the chat the connection works for from it,
// and records what it changes as that person's Owlit's. Without it the caller is a program with no chat,
// whatever it says: `as` names what owlit-mcp works for to itself, and isn't sent.
export async function connect(workspace: string, options: { dir?: string; as?: { chatId?: string }; session?: string } = {}): Promise<OwlitClient> {
  const name = path.basename(path.resolve(workspace))
  const root = await realpath(path.resolve(workspace)).catch(() => {
    throw new OwlitNotRunning(`There is no folder at ${path.resolve(workspace)}.`)
  })
  const notRunning = () => new OwlitNotRunning(`owlit isn't open with ${name}. Open it in owlit first.`)
  const pointer = await readFile(socketPaths(root, options.dir).pointer, "utf8")
    .then((text) => JSON.parse(text) as { socket: string; token: string; pid: number })
    .catch(() => {
      throw notRunning()
    })
  if (!alive(pointer.pid)) throw notRunning()

  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect(pointer.socket, () => resolve(s))
    s.once("error", () => reject(notRunning()))
  })
  socket.setEncoding("utf8")
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const listeners = new Map<string, Set<(payload: never) => void>>()
  let buffer = ""
  socket.on("data", (chunk: string) => {
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      const message = JSON.parse(line) as RpcResponse | RpcNotification
      if ("id" in message && message.id !== null && pending.has(message.id as number)) {
        const waiting = pending.get(message.id as number)!
        pending.delete(message.id as number)
        if ("error" in message) waiting.reject(new OwlitError(message.error.code, message.error.message, message.error.data))
        else waiting.resolve(message.result)
      } else if ("method" in message) {
        for (const listener of listeners.get(message.method) ?? []) listener(message.params as never)
      }
    }
  })
  socket.on("close", () => {
    for (const waiting of pending.values()) waiting.reject(new OwlitNotRunning("owlit closed the connection."))
    pending.clear()
  })

  const send = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      if (socket.destroyed) return reject(new OwlitNotRunning("owlit closed the connection."))
      const id = nextId++
      pending.set(id, { resolve, reject })
      socket.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })

  const session = options.session ?? process.env.OWLIT_SESSION
  await send("auth", { token: pointer.token, ...(session ? { session } : {}) })
  let subscribed = false

  const client: OwlitClient = {
    workspace: root,
    call: ((method: string, params?: unknown) => send(method, params)) as OwlitClient["call"],
    rpc: new Proxy({} as Rpc, {
      get: (_, namespace) => new Proxy({}, { get: (_, verb) => (params?: unknown) => send(`${String(namespace)}.${String(verb)}`, params) }),
    }),
    on(topic, listener) {
      if (!subscribed) {
        subscribed = true
        void send("notifications.subscribe", {}).catch(() => undefined)
      }
      const set = listeners.get(topic) ?? new Set()
      set.add(listener as (payload: never) => void)
      listeners.set(topic, set)
      return () => set.delete(listener as (payload: never) => void)
    },
    close: () => socket.end(),
  }
  return client
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}
