import { t } from "@lingui/core/macro"
import { RpcErrorCode, type RpcError } from "@owlit/protocol"
import { messageOf } from "../util.ts"

// Thrown by a handler to answer with a specific error. Anything else a handler throws becomes an
// InternalError whose message still reads as a sentence.
export class RpcFailure extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = "RpcFailure"
    this.code = code
    this.data = data
  }

  toJSON(): RpcError {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }
}

export const invalidParams = (message: string, data?: unknown) =>
  new RpcFailure(RpcErrorCode.InvalidParams, message, data)

export function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcFailure) return error.toJSON()
  const detail = messageOf(error)
  return { code: RpcErrorCode.InternalError, message: t`Something went wrong inside owlit.`, data: { detail } }
}
