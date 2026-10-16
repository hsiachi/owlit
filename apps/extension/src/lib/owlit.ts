import { EXTENSION_PORT, type ExtensionError, type ExtensionErrorReason } from "@owlit/protocol"
import { ext } from "./browser.ts"

// Talking to owlit on this machine (core's extension server, packages/core/src/extension/server.ts)

// owlit's fixed port on this machine (the manifest's http://127.0.0.1/* lets the extension reach it)
export const OWLIT_ORIGIN = `http://127.0.0.1:${EXTENSION_PORT}`

// owlit answered no
export class OwlitError extends Error {
  readonly status: number
  readonly reason: ExtensionErrorReason

  constructor(status: number, body: Partial<ExtensionError>) {
    super(body.message ?? `owlit answered ${status}`)
    this.status = status
    this.reason = body.reason ?? "failed"
  }
}

// Nothing answered: owlit isn't running (or another program has its port)
export class Unreachable extends Error {}

export async function ask<T>(route: string, init: { method?: string; token?: string; json?: unknown; pdf?: ArrayBuffer; signal?: AbortSignal } = {}): Promise<T> {
  // Chromium sends no Origin with this extension's GETs to owlit: owlit tells it from a web page by this
  // header (EXTENSION_HEADER in core's server.ts), which a page can't send, and knows which extension it
  // is by the origin it names, the one its other requests' Origin gives (its token is tied to it)
  const headers: Record<string, string> = { "x-owlit-extension": ext.runtime.getURL("").replace(/\/$/, "") }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  let body: BodyInit | undefined
  if (init.pdf) {
    headers["content-type"] = "application/pdf"
    body = init.pdf
  } else if (init.json !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(init.json)
  }
  let response: Response
  try {
    response = await fetch(`${OWLIT_ORIGIN}${route}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal: init.signal, cache: "no-store" })
  } catch (error) {
    if (init.signal?.aborted) throw error
    throw new Unreachable(String(error))
  }
  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    // Not owlit's answer: another program on the port
    throw new Unreachable(`Not owlit on ${OWLIT_ORIGIN}`)
  }
  if (!response.ok) throw new OwlitError(response.status, (parsed ?? {}) as Partial<ExtensionError>)
  return parsed as T
}
