import {
  RpcErrorCode,
  type MethodName,
  type ParamsOf,
  type ResultOf,
  type RpcRequest,
  type RpcResponse,
} from "@owlit/protocol"
import { z } from "zod"
import { invalidParams, RpcFailure, toRpcError } from "./errors.ts"

// Who a request came from, as far as core can tell: the window (the person at it); a program on the
// workspace's socket (owlit-mcp names the chat or run it works for and, when its engine says, the tool
// call; the CLI names none); core itself working for Owlit (an agent's ACP write, a review); a change the
// watcher saw. The watcher's evidence is the claim of a tool call that named the file (toolCallId, and
// accepted when the user allowed that call's edit); with none, chatId only says a Co-author turn was
// running. The change log's actor follows from it (changes/record.ts).
export type Caller =
  | { kind: "window" }
  | { kind: "socket"; chatId?: string; run?: string; toolCallId?: string }
  | { kind: "owlit"; chatId?: string; run?: string; toolCallId?: string }
  | { kind: "watcher"; chatId?: string; toolCallId?: string; accepted?: boolean }

export const WINDOW: Caller = { kind: "window" }

type Handler<M extends MethodName> = (params: ParamsOf<M>, caller: Caller) => ResultOf<M> | Promise<ResultOf<M>>

interface Route {
  params: z.ZodType
  handler: (params: unknown, caller: Caller) => unknown
}

// Methods that take no params accept a missing or empty params object
export const noParams = z.union([z.undefined(), z.null(), z.object({}).strict()]).transform(() => undefined)

// method → handler, with params checked against a schema before the handler sees them
export class Router {
  private routes = new Map<string, Route>()

  register<M extends MethodName>(method: M, params: z.ZodType<ParamsOf<M>, any>, handler: Handler<M>) {
    if (this.routes.has(method)) throw new Error(`${method} is registered twice`)
    this.routes.set(method, { params, handler: handler as Route["handler"] })
  }

  has(method: string) {
    return this.routes.has(method)
  }

  async handle(request: RpcRequest, caller: Caller): Promise<RpcResponse> {
    const id = request?.id ?? null
    try {
      if (!isRequest(request)) {
        throw new RpcFailure(RpcErrorCode.InvalidRequest, "That request is not well-formed JSON-RPC.")
      }
      const route = this.routes.get(request.method)
      if (!route) throw new RpcFailure(RpcErrorCode.MethodNotFound, `owlit doesn't know how to do ${request.method}.`)
      const parsed = route.params.safeParse(request.params)
      if (!parsed.success) {
        throw invalidParams(`${request.method} got parameters it can't use.`, { issues: parsed.error.issues })
      }
      const result = await route.handler(parsed.data, caller)
      return { jsonrpc: "2.0", id: request.id, result: result ?? null }
    } catch (error) {
      return { jsonrpc: "2.0", id: id as RpcRequest["id"], error: toRpcError(error, isRequest(request) ? request.method : undefined) }
    }
  }
}

function isRequest(value: unknown): value is RpcRequest {
  if (typeof value !== "object" || value === null) return false
  const r = value as Record<string, unknown>
  return r.jsonrpc === "2.0" && typeof r.method === "string" && (typeof r.id === "number" || typeof r.id === "string")
}
