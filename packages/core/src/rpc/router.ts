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

type Handler<M extends MethodName> = (params: ParamsOf<M>) => ResultOf<M> | Promise<ResultOf<M>>

interface Route {
  params: z.ZodType
  handler: (params: unknown) => unknown
}

// Methods that take no params accept a missing or empty params object
export const noParams = z.union([z.undefined(), z.null(), z.object({}).strict()]).transform(() => undefined)

// method → handler, with params checked against a schema before the handler sees them
export class Router {
  private routes = new Map<string, Route>()

  register<M extends MethodName>(method: M, params: z.ZodType<ParamsOf<M>, any>, handler: Handler<M>) {
    if (this.routes.has(method)) throw new Error(`${method} is registered twice`)
    this.routes.set(method, { params, handler: handler as (params: unknown) => unknown })
  }

  has(method: string) {
    return this.routes.has(method)
  }

  async handle(request: RpcRequest): Promise<RpcResponse> {
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
      const result = await route.handler(parsed.data)
      return { jsonrpc: "2.0", id: request.id, result: result ?? null }
    } catch (error) {
      return { jsonrpc: "2.0", id: id as RpcRequest["id"], error: toRpcError(error) }
    }
  }
}

function isRequest(value: unknown): value is RpcRequest {
  if (typeof value !== "object" || value === null) return false
  const r = value as Record<string, unknown>
  return r.jsonrpc === "2.0" && typeof r.method === "string" && (typeof r.id === "number" || typeof r.id === "string")
}
