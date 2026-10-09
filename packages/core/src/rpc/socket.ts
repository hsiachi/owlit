import type { NotificationName, RpcNotification, RpcRequest, RpcResponse } from "@owlit/protocol"
import { RpcErrorCode } from "@owlit/protocol"
import { createHash, randomBytes } from "node:crypto"
import { chmod, rm, writeFile } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

// The open workspace's JSON-RPC for programs other than the window (owlit-mcp, the CLI): a Unix socket
// in the user's temp folder, $TMPDIR/owlit-<hash>.sock (the app data path is too long for a socket
// name), and beside it owlit-<hash>.json naming the socket and a token made fresh at each start. Both are
// the user's alone (0600). A client's first message is auth with that token; then requests and answers
// go one JSON object per line, and notifications follow once it subscribes.

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
  handle(request: RpcRequest): Promise<RpcResponse>
  onNotify(listener: (notification: RpcNotification) => void): () => void
}

interface Connection {
  socket: net.Socket
  authed: boolean
  // Topics this client asked to hear; null: none yet; empty set: all
  topics: Set<string> | null
}

export class SocketServer {
  readonly paths: { socket: string; pointer: string }
  private server: net.Server
  private connections = new Set<Connection>()
  private unsubscribe: () => void

  private constructor(paths: { socket: string; pointer: string }, server: net.Server, unsubscribe: () => void) {
    this.paths = paths
    this.server = server
    this.unsubscribe = unsubscribe
  }

  // The workspace's lock is held, so a socket file already there was left by an owlit that died
  static async start(workspace: string, endpoint: Endpoint, dir?: string): Promise<SocketServer> {
    const paths = socketPaths(workspace, dir)
    await rm(paths.socket, { force: true })
    const token = randomBytes(24).toString("hex")
    const connections = new Set<Connection>()
    const server = net.createServer((socket) => {
      const connection: Connection = { socket, authed: false, topics: null }
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
      if (!connection.authed) {
        const offered = (request.params as { token?: string } | undefined)?.token
        if (request.method !== "auth" || offered !== token) {
          write(connection, { jsonrpc: "2.0", id: request.id ?? null, error: { code: RpcErrorCode.InvalidRequest, message: "owlit didn't recognise this client." } })
          connection.socket.end()
          return
        }
        connection.authed = true
        reply({ ok: true, workspace })
        return
      }
      if (request.method === "notifications.subscribe") {
        const topics = (request.params as { topics?: string[] } | undefined)?.topics
        connection.topics = new Set(topics ?? [])
        reply(null)
        return
      }
      write(connection, await endpoint.handle(request))
    }
    const unsubscribe = endpoint.onNotify((notification) => {
      for (const connection of connections) {
        if (!connection.authed || !connection.topics) continue
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
    const started = new SocketServer(paths, server, unsubscribe)
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
