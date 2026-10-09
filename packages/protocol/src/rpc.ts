import type { WorkspaceInfo } from "./workspace.ts"

// The one way to talk to core: JSON-RPC 2.0 requests with responses, and notifications from core to
// its clients. The transport (Electron IPC now, a Unix socket later) only moves these envelopes.

export interface RpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

export interface RpcError {
  code: number
  // One sentence a person can read; shown as is in the UI
  message: string
  data?: unknown
}

export type RpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | { jsonrpc: "2.0"; id: number | string; error: RpcError }

export interface RpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

// JSON-RPC's reserved codes, plus owlit's own above -32000
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Something the request names is not there (a folder, a file)
  NotFound: -32001,
  // Someone else holds it (a workspace open in another owlit)
  Conflict: -32002,
  // The request needs an open workspace and there is none
  NoWorkspace: -32003,
} as const

// Every request core answers: method name ("<area>.<verb>") → params and result. Clients are typed
// from this map; core checks params at runtime against its own schema for each method.
export interface Methods {
  "core.ping": { params: void; result: { ok: true } }
  "core.version": { params: void; result: CoreVersion }
  // The open workspace, or null before one is chosen
  "workspace.current": { params: void; result: WorkspaceInfo | null }
  // Open a folder as the workspace, closing the current one; creates .owlit/ if missing
  "workspace.open": { params: { path: string }; result: WorkspaceInfo }
  // Recently opened folders, most recent first; folders that no longer exist are left out
  "workspace.recent": { params: void; result: WorkspaceInfo[] }
  "workspace.clearRecent": { params: void; result: null }
}

// Every notification core sends: topic → payload
export interface Notifications {
  // Sent once core is up
  "core.hello": CoreVersion
  // A workspace was opened (also after a switch); clients reset what they hold for the old one
  "workspace.opened": WorkspaceInfo
}

export type MethodName = keyof Methods
export type NotificationName = keyof Notifications
export type ParamsOf<M extends MethodName> = Methods[M]["params"]
export type ResultOf<M extends MethodName> = Methods[M]["result"]

export interface CoreVersion {
  version: string
  // Node's version inside the host, e.g. Electron's
  node: string
}

// What the desktop preload exposes as window.owlit. Absent in a plain browser (pnpm dev:web).
export interface OwlitBridge {
  platform: string
  // Sends one request and resolves with core's response envelope; never rejects for an RPC error
  rpc(method: string, params?: unknown): Promise<RpcResponse>
  // Every notification core sends; returns an unsubscribe
  onNotify(listener: (notification: RpcNotification) => void): () => void
}
