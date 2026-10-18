import { t } from "@lingui/core/macro"
import type { ExtensionErrorReason } from "@owlit/protocol"
import { RpcErrorCode } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { rm } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { Transform } from "node:stream"
import { RpcFailure } from "../rpc/index.ts"
import { messageOf } from "../util.ts"

// The pieces of the extension's HTTP: an answer that is an error, and reading a request's body with a
// limit, so nothing a page could make the extension send fills memory or the disk

export class HttpFailure extends Error {
  readonly status: number
  readonly reason: ExtensionErrorReason
  readonly extra?: object

  constructor(status: number, reason: ExtensionErrorReason, message: string, extra?: object) {
    super(message)
    this.status = status
    this.reason = reason
    this.extra = extra
  }
}

// A JSON body is a paper's details, never more than this
const JSON_MAX_BYTES = 1024 * 1024

// A failure from the library, said over HTTP
export function asHttpFailure(error: unknown): HttpFailure {
  if (error instanceof HttpFailure) return error
  if (error instanceof RpcFailure) {
    if (error.code === RpcErrorCode.NotFound) return new HttpFailure(404, "not-found", error.message)
    if (error.code === RpcErrorCode.InvalidParams) return new HttpFailure(400, "bad-request", error.message)
    if (error.code === RpcErrorCode.NoWorkspace) return new HttpFailure(503, "no-workspace", error.message)
    if (error.code === RpcErrorCode.Unavailable) return new HttpFailure(503, "failed", error.message)
  }
  console.error("[core] the extension's request failed", error)
  return new HttpFailure(500, "failed", t`Something went wrong inside owlit.`, { detail: messageOf(error) })
}

export function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body)
  response.writeHead(status, { ...headers, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" })
  response.end(text)
}

const tooLarge = (what: string) => new HttpFailure(413, "too-large", what)

// Refused before a byte is read when the request says it is too large; counted as it comes otherwise
function declaredOver(request: IncomingMessage, max: number) {
  const declared = Number(request.headers["content-length"] ?? 0)
  return Number.isFinite(declared) && declared > max
}

export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (declaredOver(request, JSON_MAX_BYTES)) throw tooLarge(t`That is too much to send to owlit.`)
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > JSON_MAX_BYTES) throw tooLarge(t`That is too much to send to owlit.`)
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpFailure(400, "bad-request", t`owlit couldn't read what the extension sent.`)
  }
}

// The body written to a file of its own in the temp folder; the caller removes it (removeQuietly)
export async function readToFile(request: IncomingMessage, max: number, dir = tmpdir()): Promise<string> {
  const limit = t`That PDF is larger than owlit takes.`
  if (declaredOver(request, max)) throw tooLarge(limit)
  const file = path.join(dir, `owlit-extension-${randomUUID()}.pdf`)
  let size = 0
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length
      done(size > max ? tooLarge(limit) : null, chunk)
    },
  })
  try {
    await pipeline(request, count, createWriteStream(file, { mode: 0o600 }))
  } catch (error) {
    await removeQuietly(file)
    throw error
  }
  return file
}

export const removeQuietly = (file: string) => rm(file, { force: true }).catch(() => undefined)
