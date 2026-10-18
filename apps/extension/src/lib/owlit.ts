import { EXTENSION_PORT, OWLIT_ID_HEADER, OWLIT_NAME_HEADER, type ExtensionError, type ExtensionErrorReason } from "@owlit/protocol"
import { ext } from "./browser.ts"

// Talking to owlit on this machine (core's extension server, packages/core/src/extension/server.ts)

// The dev build's port (scripts/build.mjs --dev), for Owlit Dev; unset in the store builds and the tests
declare const __OWLIT_PORT__: number | undefined

// owlit's fixed port on this machine (the manifest's http://127.0.0.1/* lets the extension reach it)
export const OWLIT_ORIGIN = `http://127.0.0.1:${typeof __OWLIT_PORT__ === "number" ? __OWLIT_PORT__ : EXTENSION_PORT}`

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

// Another owlit answered than the one this extension is paired with (a preview, a second copy): nothing
// is asked of it, and the pairing is kept for when the right one is back
export class Elsewhere extends Error {
  readonly owlitName: string

  constructor(name: string) {
    super(`${name} answered, not the owlit this browser is connected to`)
    this.owlitName = name
  }
}

export interface AskInit {
  method?: string
  token?: string
  // The id of the owlit the token was given by: an answer from another one is Elsewhere
  owlit?: string
  json?: unknown
  pdf?: ArrayBuffer
  signal?: AbortSignal
}

export async function ask<T>(route: string, init: AskInit = {}): Promise<T> {
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
  // Before anything else of the answer: another owlit's 401 doesn't mean this browser was forgotten
  const answeredBy = response.headers.get(OWLIT_ID_HEADER)
  if (init.owlit && answeredBy && answeredBy !== init.owlit) {
    void response.body?.cancel()
    throw new Elsewhere(decodeURIComponent(response.headers.get(OWLIT_NAME_HEADER) ?? "") || "Another owlit")
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
