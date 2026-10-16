import type { ExtensionView, RpcNotification } from "@owlit/protocol"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { makePdf, paragraph } from "../library/text/make-pdf.ts"
import type { ExtensionServer } from "./server.ts"

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, "../library/fixtures", name), "utf8")
const published = {
  "api.openalex.org/works/doi:10.1145": fixture("openalex-doi.json"),
  "api.semanticscholar.org/graph/v1/paper/DOI:10.1145": fixture("s2-doi.json"),
}
const DOI = "10.1145/3626772.3657891"
const ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((clean) => clean()))
})

// A core serving the extension on a free port, whose network serves recorded responses
async function setup(options: { routes?: Record<string, string | number>; workspace?: boolean; port?: number; retryMs?: number } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), "owlit-extension-")))
  const root = path.join(base, "ws")
  mkdirSync(root)
  const routes = options.routes ?? {}
  const fetch = (async (url: string) => {
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern))
    if (!match) return new Response("not found", { status: 404 })
    return typeof match[1] === "number" ? new Response("", { status: match[1] }) : new Response(match[1])
  }) as unknown as typeof globalThis.fetch
  const userDataDir = path.join(base, "userData")
  const core = new Core({ userDataDir, host: { fetch }, retryBaseMs: 1, extension: { port: options.port ?? 0, retryMs: options.retryMs } })
  cleanups.push(() => core.dispose())
  const call = async (method: string, params?: unknown): Promise<any> => {
    const response = await core.handle({ jsonrpc: "2.0", id: 1, method, params })
    if ("error" in response) throw Object.assign(new Error(response.error.message), response.error)
    return response.result
  }
  const views: ExtensionView[] = []
  core.onNotify((n: RpcNotification) => {
    if (n.method === "extension.changed") views.push(n.params as ExtensionView)
  })
  if (options.workspace !== false) await call("workspace.open", { path: root })
  const server = (core as unknown as { extension: ExtensionServer }).extension
  await server.start()
  const request = async (route: string, init: { method?: string; token?: string; origin?: string | null; body?: unknown; bytes?: Buffer } = {}) => {
    const headers: Record<string, string> = {}
    if (init.origin !== null) headers.origin = init.origin ?? ORIGIN
    if (init.token) headers.authorization = `Bearer ${init.token}`
    let body: Uint8Array | string | undefined
    if (init.bytes) {
      headers["content-type"] = "application/pdf"
      body = new Uint8Array(init.bytes)
    } else if (init.body !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(init.body)
    }
    const response = await globalThis.fetch(`http://127.0.0.1:${server.port}${route}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body })
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
  }
  // Paired as the user would: the question in a window, answered Allow
  const pair = async (browser = "Chrome") => {
    await call("ui.focus", { clientId: "window-1" })
    const started = await request("/pair", { body: { browser, extensionVersion: "0.1.0" } })
    expect(started.status).toBe(202)
    await vi.waitFor(async () => expect((await call("extension.get")).asking).toHaveLength(1))
    const [asking] = (await call("extension.get")).asking
    await call("extension.answer", { id: asking.id, allow: true })
    const answer = await request(`/pair/${started.body.pairing}`)
    expect(answer.body.state).toBe("allowed")
    return answer.body.token as string
  }
  const putPaper = (id: string, record: object) => {
    const dir = path.join(root, "library/papers", id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, id, authors: [], fields: {}, ...record }))
  }
  return { core, call, request, pair, putPaper, root, userDataDir, server, views }
}

const pdfOf = (lines: string[]) => Buffer.from(makePdf([[...lines.map((text, i) => ({ x: 72, y: 60 + i * 30, size: 12, text })), ...paragraph(72, 300, ["Body text of the paper."])]]))

describe("the extension's port", () => {
  it("turns away anything that isn't an extension, before reading it", async () => {
    const { request } = await setup()
    expect((await request("/status", { origin: null })).status).toBe(403)
    expect((await request("/status", { origin: "https://example.com" })).body).toMatchObject({ reason: "not-an-extension" })
    expect((await request("/pair", { origin: "https://example.com", body: { browser: "Chrome" } })).status).toBe(403)
    expect((await request("/pair", { method: "OPTIONS", origin: "https://example.com" })).status).toBe(403)
    const preflight = await request("/pair", { method: "OPTIONS" })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ORIGIN)
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization")
  })

  it("answers only a paired extension, by its token", async () => {
    const { request, pair } = await setup()
    expect((await request("/status")).status).toBe(401)
    expect((await request("/status", { token: "not-the-token" })).body).toMatchObject({ reason: "not-paired" })
    const token = await pair()
    const status = await request("/status", { token })
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({ workspace: { name: "ws" } })
    expect(status.body.connectedAt).toBeGreaterThan(0)
    expect(status.headers.get("access-control-allow-origin")).toBe(ORIGIN)
  })

  it("pairs once the user allows it, keeping only the token's hash", async () => {
    const { call, request, pair, userDataDir, views } = await setup()
    // No window to ask in
    const alone = await request("/pair", { body: { browser: "Chrome" } })
    expect(alone).toMatchObject({ status: 503, body: { reason: "no-window" } })
    const token = await pair("Dia")
    const stored = JSON.parse(readFileSync(path.join(userDataDir, "settings.json"), "utf8"))
    expect(stored.extension.paired).toEqual([expect.objectContaining({ browser: "Dia", pairedAt: expect.any(Number) })])
    expect(JSON.stringify(stored)).not.toContain(token)
    // The window heard the question, then the answer
    expect(views.some((v) => v.asking.length === 1)).toBe(true)
    expect(views.at(-1)?.asking).toEqual([])
    // Seen when it asks something
    await request("/status", { token })
    await vi.waitFor(async () => expect((await call("extension.get")).paired[0].lastSeenAt).toBeGreaterThan(0))
    // Forgotten in Settings: the extension has to ask again
    const view = await call("extension.forget", { id: stored.extension.paired[0].id })
    expect(view.paired).toEqual([])
    expect((await request("/status", { token })).status).toBe(401)
  })

  it("tells the extension when the user doesn't allow it", async () => {
    const { call, request } = await setup()
    await call("ui.focus", { clientId: "window-1" })
    const started = await request("/pair", { body: { browser: "Chrome" } })
    await vi.waitFor(async () => expect((await call("extension.get")).asking).toHaveLength(1))
    // Already waiting for the answer when it comes
    const waiting = request(`/pair/${started.body.pairing}`)
    const [asking] = (await call("extension.get")).asking
    await call("extension.answer", { id: asking.id, allow: false })
    expect(await waiting).toMatchObject({ status: 403, body: { reason: "refused" } })
    expect((await call("extension.get")).paired).toEqual([])
  })

  it("says so when no workspace is open", async () => {
    const { request, pair } = await setup({ workspace: false })
    const token = await pair()
    expect((await request("/status", { token })).body.workspace).toBeNull()
    expect(await request(`/papers?doi=${DOI}`, { token })).toMatchObject({ status: 503, body: { reason: "no-workspace" } })
  })

  it("adds the page's paper by its DOI, once", async () => {
    const { request, pair } = await setup({ routes: published })
    const token = await pair()
    expect((await request(`/papers?doi=${DOI}`, { token })).body).toEqual({ paper: null })
    const added = await request("/papers", { token, body: { doi: DOI, title: "The page's title", url: `https://dl.acm.org/doi/${DOI}` } })
    expect(added.status).toBe(201)
    expect(added.body.paper).toMatchObject({ id: "doi-10.1145-3626772.3657891", hasPdf: false })
    expect(added.body.paper.title).toMatch(/^ChroniclingAmericaQA/)
    const again = await request("/papers", { token, body: { doi: DOI.toUpperCase() } })
    expect(again).toMatchObject({ status: 200, body: { paper: { id: "doi-10.1145-3626772.3657891" } } })
    // Found by the DOI in a page's address too
    expect((await request(`/papers?url=${encodeURIComponent(`https://dl.acm.org/doi/abs/${DOI}`)}`, { token })).body.paper).toMatchObject({ id: "doi-10.1145-3626772.3657891" })
  })

  it("adds a paper from the page's own words when nothing resolves", async () => {
    const { request, pair } = await setup({ routes: { "api.openalex.org": 503, "api.semanticscholar.org": 503, "api.crossref.org": 503 } })
    const token = await pair()
    const added = await request("/papers", { token, body: { doi: "10.9999/unknown.1", title: "A Paper Nobody Indexed Yet", authors: ["A. Writer"], year: 2026 } })
    expect(added.body.paper).toMatchObject({ id: "doi-10.9999-unknown.1", title: "A Paper Nobody Indexed Yet", hasPdf: false })
    expect((await request("/papers", { token, body: { url: "https://example.org/nothing" } })).body).toMatchObject({ reason: "bad-request" })
  })

  it("takes a paper's PDF from the extension as the extension's try", async () => {
    const { request, pair, putPaper, root } = await setup()
    const token = await pair()
    const id = "doi-10.1145-3626772.3657891"
    putPaper(id, { title: "ChroniclingAmericaQA: A Large-scale Question Answering Dataset", ids: { doi: DOI } })
    // Another paper's PDF isn't taken for it
    const wrong = await request(`/papers/${id}/pdf`, { token, method: "PUT", bytes: pdfOf(["https://doi.org/10.1000/other.paper", "Something Else Entirely, A Study of Other Things"]) })
    expect(wrong).toMatchObject({ status: 422, body: { reason: "not-this-paper" } })
    expect((await request(`/papers/${id}/pdf`, { token, method: "PUT", bytes: Buffer.from("<html>sign in</html>") })).body).toMatchObject({ reason: "not-a-pdf" })
    const put = await request(`/papers/${id}/pdf`, { token, method: "PUT", bytes: pdfOf([`https://doi.org/${DOI}`, "ChroniclingAmericaQA: A Large-scale Question Answering Dataset"]) })
    expect(put).toMatchObject({ status: 200, body: { paper: { id, hasPdf: true } } })
    const acquisition = JSON.parse(readFileSync(path.join(root, "library/papers", id, "acquisition.json"), "utf8"))
    expect(acquisition.state).toBe("have-it")
    expect(acquisition.tried.at(-1)).toMatchObject({ by: "extension", ended: "pdf", route: "extension" })
    // It has one now
    expect((await request(`/papers/${id}/pdf`, { token, method: "PUT", bytes: pdfOf([`https://doi.org/${DOI}`]) })).body).toMatchObject({ reason: "has-pdf" })
  })

  it("matches a PDF that names no paper to the Library's paper lacking it, or drops it", async () => {
    const { request, pair, putPaper } = await setup()
    const token = await pair()
    putPaper("doi-10.1000-margins.7", { title: "Notes Toward a Theory of Margins", ids: { doi: "10.1000/margins.7" } })
    const stranger = await request("/pdfs", { token, method: "PUT", bytes: pdfOf(["https://doi.org/10.1000/unrelated.2", "An Unrelated Paper About Something Else"]) })
    expect(stranger).toMatchObject({ status: 404, body: { reason: "not-a-library-paper" } })
    const taken = await request("/pdfs", { token, method: "PUT", bytes: pdfOf(["https://doi.org/10.1000/margins.7", "Notes Toward a Theory of Margins"]) })
    expect(taken).toMatchObject({ status: 200, body: { paper: { id: "doi-10.1000-margins.7", hasPdf: true } } })
  })

  it("waits for the port while another program has it, and takes it once it is free", async () => {
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve))
    const port = (blocker.address() as net.AddressInfo).port
    const { call } = await setup({ port, retryMs: 20 })
    expect(await call("extension.get")).toMatchObject({ serving: false, portTaken: true })
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
    await vi.waitFor(async () => expect(await call("extension.get")).toMatchObject({ serving: true, portTaken: false }))
  })
})
