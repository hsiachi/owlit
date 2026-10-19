import type { NotificationName, RpcNotification, RpcRequest, RpcResponse } from "@owlit/protocol"
import { RpcErrorCode } from "@owlit/protocol"
import { createHash, randomBytes } from "node:crypto"
import { chmod, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Caller } from "./router.ts"

// The open workspace's JSON-RPC for programs other than the window (owlit-mcp, the CLI): a Unix socket
// in the user's temp folder, $TMPDIR/owlit-<hash>.sock (the app data path is too long for a socket
// name), and beside it owlit-<hash>.json naming the socket and a token made fresh at each start. Both are
// the user's alone (0600). A client's first message is auth with that token and, for an owlit-mcp core
// started for an agent session, the session secret core gave it (grant): only that names the chat or run
// it works for. A chat id a client names itself is never taken, so a program can't borrow a chat's role
// by naming it. Then requests and answers go one JSON object per line, and notifications follow once it
// subscribes.

export interface SocketPointer {
  version: 1
  socket: string
  token: string
  pid: number
  workspace: string
}

// The 12 hex digits that name a workspace's socket: sha1 of its real path in NFC, as its data folder
export const socketHash = (workspace: string) => createHash("sha1").update(workspace.normalize("NFC")).digest("hex").slice(0, 12)

export const socketPaths = (workspace: string, dir = tmpdir()) => {
  const hash = socketHash(workspace)
  return { socket: path.join(dir, `owlit-${hash}.sock`), pointer: path.join(dir, `owlit-${hash}.json`) }
}

interface Endpoint {
  handle(request: RpcRequest, caller: Caller): Promise<RpcResponse>
  onNotify(listener: (notification: RpcNotification) => void): () => void
}

interface Connection {
  socket: net.Socket
  // Who calls on this connection, from its auth; null until then
  caller: Extract<Caller, { kind: "socket" }> | null
  // Topics this client asked to hear; null: none yet; empty set: all
  topics: Set<string> | null
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined)

// What a session secret was granted for: the chat or run of the agent session owlit-mcp was started for
export interface Grant {
  chatId?: string
  run?: string
}

// The caller a connection is: the chat or run its session secret was granted for; the CLI, or a program
// with no secret, names neither
function callerOf(granted: Grant | undefined): Extract<Caller, { kind: "socket" }> {
  return { kind: "socket", ...(granted?.chatId ? { chatId: granted.chatId } : {}), ...(granted?.run ? { run: granted.run } : {}) }
}

// The tool call a request is for changes with each call (Claude Code names it per MCP request), so it
// comes in the call's params
function withToolCall(caller: Extract<Caller, { kind: "socket" }>, request: RpcRequest): Caller {
  const params = (request.params ?? {}) as { toolCallId?: unknown }
  const toolCallId = text(params.toolCallId)
  return toolCallId ? { ...caller, toolCallId } : caller
}

export class SocketServer {
  // The workspace it serves
  readonly root: string
  readonly paths: { socket: string; pointer: string }
  private server: net.Server
  private connections = new Set<Connection>()
  private unsubscribe: () => void
  // Session secrets by value; they live as long as the socket, as the sessions they were made for can
  private readonly sessions: Map<string, Grant>

  private constructor(root: string, paths: { socket: string; pointer: string }, server: net.Server, unsubscribe: () => void, sessions: Map<string, Grant>) {
    this.root = root
    this.paths = paths
    this.server = server
    this.unsubscribe = unsubscribe
    this.sessions = sessions
  }

  // A secret for the owlit-mcp of one agent session, which names its chat or run when it authenticates
  grant(granted: Grant): string {
    const secret = randomBytes(24).toString("hex")
    this.sessions.set(secret, granted)
    return secret
  }

  // The workspace's lock is held, so a socket file already there was left by an owlit that died
  static async start(workspace: string, endpoint: Endpoint, dir?: string): Promise<SocketServer> {
    const paths = socketPaths(workspace, dir)
    await rm(paths.socket, { force: true })
    const token = randomBytes(24).toString("hex")
    const sessions = new Map<string, Grant>()
    const connections = new Set<Connection>()
    const server = net.createServer((socket) => {
      const connection: Connection = { socket, caller: null, topics: null }
      connections.add(connection)
      socket.setEncoding("utf8")
      let buffer = ""
      socket.on("data", (chunk: string) => {
        buffer += chunk
        let newline: number
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (line) void receive(connection, line)
        }
      })
      socket.on("close", () => connections.delete(connection))
      socket.on("error", () => connections.delete(connection))
    })
    const write = (connection: Connection, message: unknown) => {
      if (!connection.socket.destroyed) connection.socket.write(JSON.stringify(message) + "\n")
    }
    const receive = async (connection: Connection, line: string) => {
      let request: RpcRequest
      try {
        request = JSON.parse(line) as RpcRequest
      } catch {
        write(connection, { jsonrpc: "2.0", id: null, error: { code: RpcErrorCode.ParseError, message: "That isn't JSON." } })
        return
      }
      const reply = (result: unknown) => write(connection, { jsonrpc: "2.0", id: request.id, result })
      if (!connection.caller) {
        const auth = (request.params ?? {}) as { token?: unknown; session?: unknown }
        if (request.method !== "auth" || auth.token !== token) {
          write(connection, { jsonrpc: "2.0", id: request.id ?? null, error: { code: RpcErrorCode.InvalidRequest, message: "owlit didn't recognise this client." } })
          connection.socket.end()
          return
        }
        const session = text(auth.session)
        connection.caller = callerOf(session ? sessions.get(session) : undefined)
        reply({ ok: true, workspace })
        return
      }
      if (request.method === "notifications.subscribe") {
        const topics = (request.params as { topics?: string[] } | undefined)?.topics
        connection.topics = new Set(topics ?? [])
        reply(null)
        return
      }
      write(connection, await endpoint.handle(request, withToolCall(connection.caller, request)))
    }
    const unsubscribe = endpoint.onNotify((notification) => {
      for (const connection of connections) {
        if (!connection.caller || !connection.topics) continue
        if (connection.topics.size && !connection.topics.has(notification.method as NotificationName)) continue
        write(connection, notification)
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(paths.socket, () => {
        server.off("error", reject)
        resolve()
      })
    })
    await chmod(paths.socket, 0o600)
    const pointer: SocketPointer = { version: 1, socket: paths.socket, token, pid: process.pid, workspace }
    await writeFile(paths.pointer, JSON.stringify(pointer) + "\n", { mode: 0o600 })
    const started = new SocketServer(workspace, paths, server, unsubscribe, sessions)
    started.connections = connections
    return started
  }

  async close() {
    this.unsubscribe()
    for (const connection of this.connections) connection.socket.destroy()
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
    await rm(this.paths.socket, { force: true })
    await rm(this.paths.pointer, { force: true })
  }
}
