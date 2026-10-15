// core's fetch: Chromium's network stack (the system proxy and certificates, which Node's fetch ignores)
// with responses that say where they came from. Electron's net.fetch follows redirects but answers
// with url "" and redirected false (Electron 44), and core needs to know where a link led: doi.org
// hands over to the publisher, and holds, logs and relative PDF links go by the publisher's address.
// So GET and HEAD are made here over net.request, whose redirect events carry each new address, the
// way net.fetch makes them (session cookies, the Response's body). Anything with a body stays on
// net.fetch, where nothing reads where it ended.

import { net } from "electron"
import { Readable } from "node:stream"

export function hostFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase()
  if (input instanceof Request || init?.body != null || (method !== "GET" && method !== "HEAD")) return net.fetch(input as string, init)
  const signal = init?.signal
  if (signal?.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    let url = String(input)
    let redirected = false
    // credentials as net.fetch has them for a request without an origin: the session's cookies go along
    const request = net.request({ method, url, credentials: "include", cache: init?.cache, redirect: "follow" })
    for (const [name, value] of new Headers(init?.headers)) request.setHeader(name, value)
    // Redirects are followed by Chromium; each one says where it goes next
    request.on("redirect", (_status, _method, next) => {
      url = next
      redirected = true
    })
    const onAbort = () => {
      reject(abortReason(signal!))
      request.abort()
    }
    signal?.addEventListener("abort", onAbort, { once: true })
    request.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      reject(error)
    })
    request.on("response", (message) => {
      const headers = new Headers()
      for (const [name, value] of Object.entries(message.headers)) headers.set(name, Array.isArray(value) ? value.join(", ") : value)
      // Electron's IncomingMessage is a Node Readable underneath
      const stream = message as unknown as Readable
      const empty = [101, 204, 205, 304].includes(message.statusCode) || method === "HEAD"
      // An abort while the body is read ends the body too (request.abort destroys the message)
      stream.on("close", () => signal?.removeEventListener("abort", onAbort))
      if (empty) stream.resume()
      const body = empty ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>)
      try {
        const response = new Response(body, { status: message.statusCode, statusText: message.statusMessage, headers })
        Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } })
        resolve(response)
      } catch (error) {
        // A status Response won't take (outside 200–599): a failed request, not an uncaught error in main
        request.abort()
        reject(error)
      }
    })
    request.end()
  })
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError")
}
