import {
  RpcErrorCode,
  type MethodName,
  type ParamsOf,
  type ResultOf,
  type RpcRequest,
  type RpcResponse,
  type Touches,
} from "@owlit/protocol"
import { z } from "zod"
import type { Target, Who } from "../agents/policy.ts"
import { invalidParams, RpcFailure, toRpcError } from "./errors.ts"

// Who a request came from, as far as core can tell: the window (the person at it); a program on the
// workspace's socket (owlit-mcp names the chat it works for and, when its engine says, the tool
// call; the CLI names none); core itself working for Owlit (an agent's ACP write); a change the
// watcher saw. The watcher's evidence is the claim of a tool call that named the file (toolCallId, and
// accepted when the user allowed that call's edit); with none, chatId only says a Co-author turn was
// running. The change log's actor follows from it (changes/record.ts).
export type Caller =
  | { kind: "window" }
  | { kind: "socket"; chatId?: string; toolCallId?: string }
  | { kind: "owlit"; chatId?: string; toolCallId?: string }
  | { kind: "watcher"; chatId?: string; toolCallId?: string; accepted?: boolean }

export const WINDOW: Caller = { kind: "window" }

type Handler<M extends MethodName> = (params: ParamsOf<M>, caller: Caller) => ResultOf<M> | Promise<ResultOf<M>>

// What a method touches (protocol's Touches), declared with it. A method whose class depends on what it
// is asked to do (comments.put resolves a comment or edits an entry) gives a function of its params, of
// whose thing the target is and of who asks; target looks the thing up, and is also what the policy's
// own test reads (agents/policy.ts).
export interface Policy<M extends MethodName = MethodName> {
  touches: Touches | ((params: ParamsOf<M>, target: Target, who: Who) => Touches)
  target?: (params: ParamsOf<M>) => Promise<Target>
}

// Decides before a handler runs whether this caller may make this call; throws (an RpcFailure) to refuse.
// The window is never refused. Set by Core, which knows the chat's role.
export type Decide = (caller: Caller, method: string, params: unknown, policy: Policy) => Promise<void>

interface Route {
  params: z.ZodType
  policy: Policy
  handler: (params: unknown, caller: Caller) => unknown
}

// Methods that take no params accept a missing or empty params object
export const noParams = z.union([z.undefined(), z.null(), z.object({}).strict()]).transform(() => undefined)

// A doc or folder as a client names it, relative to the workspace; the workspace resolves and checks it
export const docPath = z.string()

// method → handler, with params checked against a schema before the handler sees them, and the policy
// applied between the two
export class Router {
  private routes = new Map<string, Route>()
  decide: Decide | null = null

  // policy: a class alone, or one with how to find its target and name the change
  register<M extends MethodName>(method: M, params: z.ZodType<ParamsOf<M>, any>, policy: Touches | Policy<M>, handler: Handler<M>) {
    if (this.routes.has(method)) throw new Error(`${method} is registered twice`)
    this.routes.set(method, { params, policy: (typeof policy === "string" ? { touches: policy } : policy) as Policy, handler: handler as Route["handler"] })
  }

  has(method: string) {
    return this.routes.has(method)
  }

  // What a method declares it touches, when that is one class
  touchesOf(method: string): Touches | "depends" | undefined {
    const policy = this.routes.get(method)?.policy
    if (!policy) return undefined
    return typeof policy.touches === "function" ? "depends" : policy.touches
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
        // The first issue, so an agent can correct its call: "limit: Too big: expected number to be <=50"
        const [issue] = parsed.error.issues
        const why = issue ? `: ${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}` : ""
        throw invalidParams(`${request.method} got parameters it can't use${why}.`, { issues: parsed.error.issues })
      }
      if (route.policy.touches !== "read" && this.decide) await this.decide(caller, request.method, parsed.data, route.policy)
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
