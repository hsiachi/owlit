import { t } from "@lingui/core/macro"
import { RpcErrorCode, type RpcError } from "@owlit/protocol"
import path from "node:path"
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

// Anything else is logged with its stack, since the answer only names it. A file system error that names a
// file (a doc locked in Finder, a full disk) says which file and why, for the user and for agents.
export function toRpcError(error: unknown, method?: string): RpcError {
  if (error instanceof RpcFailure) return error.toJSON()
  console.error(`[core] ${method ?? "a request"} failed`, error)
  const detail = messageOf(error)
  const known = fileError(error as NodeJS.ErrnoException)
  return known ? { ...known, data: { detail } } : { code: RpcErrorCode.InternalError, message: t`Something went wrong inside owlit.`, data: { detail } }
}

function fileError({ code, path: file }: NodeJS.ErrnoException) {
  if (!file) return undefined
  const name = path.basename(file)
  switch (code) {
    case "EPERM":
    case "EACCES":
      return { code: RpcErrorCode.Forbidden, message: t`owlit isn't allowed to change ${name}. It may be locked in Finder or kept from owlit by macOS.` }
    case "EROFS":
      return { code: RpcErrorCode.Forbidden, message: t`${name} is on a disk owlit can't write to.` }
    case "ENOSPC":
      return { code: RpcErrorCode.InternalError, message: t`The disk is full, so ${name} couldn't be saved.` }
    case "ENOENT":
      return { code: RpcErrorCode.NotFound, message: t`${name} is no longer there.` }
  }
  return undefined
}
