import type { ExtensionView, RpcNotification } from "@owlit/protocol"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Core } from "../core.ts"
import { makePdf, paragraph } from "../library/text/make-pdf.ts"
import { eventually } from "../test-util.ts"
import type { BrowserApp } from "./browser-app.ts"
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
  // A test that mocks Date.now and fails before its own restore must not leave the mock to the rest
  vi.restoreAllMocks()
  await Promise.all(cleanups.splice(0).map((clean) => clean()))
})

// A core serving the extension on a free port, whose network serves recorded responses
type Opened = [string, { app?: string; name?: string }]

async function setup(options: { routes?: Record<string, string | number>; workspace?: boolean; port?: number; retryMs?: number; holdMs?: number; opened?: Opened[]; shown?: Opened[1][]; browserApp?: (remotePort: number) => Promise<BrowserApp | undefined> } = {}) {
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
  const core = new Core({ userDataDir, host: { fetch, openInBrowser: async (url, browser) => void options.opened?.push([url, browser]), showBrowser: async (browser) => void options.shown?.push(browser), browserApp: options.browserApp }, retryBaseMs: 1, extension: { port: options.port ?? 0, retryMs: options.retryMs, holdMs: options.holdMs, work: { gapMs: 0, proxyGapMs: 0 } } })
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
  const request = async (route: string, init: { method?: string; token?: string; origin?: string | null; headers?: Record<string, string>; body?: unknown; bytes?: Buffer } = {}) => {
    const headers: Record<string, string> = { ...init.headers }
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
    await eventually(async () => expect((await call("extension.get")).asking).toHaveLength(1))
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
    // Chromium's GET from an extension carries no Origin: the extension names itself in a header a page
    // can't send
    expect((await request("/status", { origin: null, headers: { "x-owlit-extension": "1" } })).body).toMatchObject({ reason: "not-paired" })
    expect((await request("/status", { origin: "https://example.com", headers: { "x-owlit-extension": "1" } })).status).toBe(403)
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
    await eventually(async () => expect((await call("extension.get")).paired[0].lastSeenAt).toBeGreaterThan(0))
    // Forgotten in Settings: the extension has to ask again
    const view = await call("extension.forget", { id: stored.extension.paired[0].id })
    expect(view.paired).toEqual([])
    expect((await request("/status", { token })).status).toBe(401)
  })

  it("names the browser by the app its requests come from, over what the extension says", async () => {
    const dia: BrowserApp = { id: "company.thebrowser.dia", name: "Dia" }
    const ports: number[] = []
    const { call, request, pair, server, userDataDir } = await setup({ browserApp: async (port) => (ports.push(port), dia) })
    await call("ui.focus", { clientId: "window-1" })
    await request("/pair", { body: { browser: "Chromium" } })
    await eventually(async () => expect((await call("extension.get")).asking).toHaveLength(1))
    // Asked by the port the request came from, not owlit's own
    expect(ports).toHaveLength(1)
    expect(ports[0]).toBeGreaterThan(0)
    expect(ports[0]).not.toBe(server.port)
    expect((await call("extension.get")).asking[0]).toMatchObject({ browser: "Dia" })
    await call("extension.answer", { id: (await call("extension.get")).asking[0].id, allow: false })
    await pair("Chromium")
    const stored = JSON.parse(readFileSync(path.join(userDataDir, "settings.json"), "utf8"))
    expect(stored.extension.paired).toEqual([expect.objectContaining({ browser: "Dia", app: "company.thebrowser.dia" })])
  })

  it("learns the app of a pairing made before owlit could tell, once", async () => {
    let app: BrowserApp | undefined
    let asked = 0
    const { call, request, pair } = await setup({ browserApp: async () => (asked++, app) })
    const token = await pair("Chromium")
    expect((await call("extension.get")).paired).toEqual([expect.objectContaining({ browser: "Chromium" })])
    // The system can tell now: the pairing's first request looks it up, and the next ones don't
    app = { id: "company.thebrowser.dia", name: "Dia" }
    asked = 0
    await request("/status", { token })
    await request("/status", { token })
    expect(asked).toBe(1)
    await eventually(async () => expect((await call("extension.get")).paired).toEqual([expect.objectContaining({ browser: "Dia" })]))
  })

  it("says which owlit answers, to a paired extension and to one paired elsewhere", async () => {
    const { request, pair } = await setup()
    const stranger = await request("/status", { token: "paired-with-another-owlit" })
    expect(stranger.status).toBe(401)
    const id = stranger.headers.get("x-owlit-id")
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(decodeURIComponent(stranger.headers.get("x-owlit-name")!)).toBe("Owlit")
    const token = await pair()
    expect((await request("/status", { token })).body.owlit).toEqual({ id, name: "Owlit" })
  })

  it("shows who is asking, and ties the token to that extension", async () => {
    const { call, request, userDataDir } = await setup()
    await call("ui.focus", { clientId: "window-1" })
    const started = await request("/pair", { body: { browser: "Chrome" } })
    await eventually(async () => expect((await call("extension.get")).asking).toHaveLength(1))
    const [asking] = (await call("extension.get")).asking
    expect(asking).toMatchObject({ browser: "Chrome", origin: ORIGIN })
    await call("extension.answer", { id: asking.id, allow: true })
    // Allowed but not yet collected: nothing is listed, nor kept
    expect((await call("extension.get")).paired).toEqual([])
    const settingsFile = path.join(userDataDir, "settings.json")
    expect(existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")).extension?.paired ?? [] : []).toEqual([])
    // Another extension can't collect the token
    const other = "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba"
    expect((await request(`/pair/${started.body.pairing}`, { origin: other })).status).toBe(404)
    const answer = await request(`/pair/${started.body.pairing}`, { origin: null, headers: { "x-owlit-extension": ORIGIN } })
    expect(answer.body.state).toBe("allowed")
    const token = answer.body.token as string
    expect((await call("extension.get")).paired).toEqual([expect.objectContaining({ browser: "Chrome", origin: ORIGIN })])
    // The token works for that extension only, with its Origin or, where the browser sends none, its header
    expect((await request("/status", { token })).status).toBe(200)
    expect((await request("/status", { token, origin: null, headers: { "x-owlit-extension": ORIGIN } })).status).toBe(200)
    expect((await request("/status", { token, origin: other })).status).toBe(401)
    expect((await request("/status", { token, origin: null, headers: { "x-owlit-extension": "1" } })).status).toBe(401)
  })

  it("tells the extension when the user doesn't allow it", async () => {
    const { call, request } = await setup()
    await call("ui.focus", { clientId: "window-1" })
    const started = await request("/pair", { body: { browser: "Chrome" } })
    await eventually(async () => expect((await call("extension.get")).asking).toHaveLength(1))
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

  it("brings owlit to the front, on a Library paper when one is named", async () => {
    const { request, pair, call, core } = await setup({ routes: published })
    const token = await pair()
    const shown: unknown[] = []
    core.onNotify((n: RpcNotification) => {
      if (n.method !== "ui.request") return
      const asked = n.params as { requestId: string; method: string; params: unknown }
      shown.push(asked.params)
      void call("ui.respond", { requestId: asked.requestId, result: { title: "ChroniclingAmericaQA" } })
    })
    const { body } = await request("/papers", { token, body: { doi: DOI } })
    expect(await request("/open", { token, body: { paper: body.paper.id } })).toMatchObject({ status: 200, body: { shown: true } })
    expect(shown).toEqual([{ uri: `owlit://library/${body.paper.id}` }])
    expect(await request("/open", { token, body: {} })).toMatchObject({ status: 200, body: { shown: true } })
    expect(await request("/open", { token, body: { paper: "nothing-like-it" } })).toMatchObject({ status: 404, body: { reason: "not-found" } })
    expect(await request("/open", { body: {} })).toMatchObject({ status: 401 })
  })

  it("adds a paper from the page's own words when nothing resolves", async () => {
    const { request, pair, call } = await setup({ routes: { "api.openalex.org": 503, "api.semanticscholar.org": 503, "api.crossref.org": 503 } })
    const token = await pair()
    const added = await request("/papers", { token, body: { doi: "10.9999/unknown.1", title: "A Paper Nobody Indexed Yet", authors: ["A. Writer"], year: 2026 } })
    expect(added.body.paper).toMatchObject({ id: "doi-10.9999-unknown.1", title: "A Paper Nobody Indexed Yet", hasPdf: false })
    // The person's addition, which they can undo
    expect(await call("changes.list", { path: "doi-10.9999-unknown.1" })).toMatchObject([{ actor: expect.stringMatching(/^p_/), action: "create", target: { kind: "paper" } }])
    expect((await request("/papers", { token, body: { url: "https://example.org/nothing" } })).body).toMatchObject({ reason: "bad-request" })
  })

  it("finds a paper from a page that names no id by its address, or by its title", async () => {
    const { request, pair, putPaper } = await setup({ routes: { "api.openalex.org": 503, "api.semanticscholar.org": 503, "api.crossref.org": 503 } })
    const token = await pair()
    putPaper("doi-10.1000-margins.7", { title: "Notes Toward a Theory of Margins", ids: { doi: "10.1000/margins.7" } })
    const url = "https://journals.example.org/article/view/412"
    const added = await request("/papers", { token, body: { url, title: "A Paper Its Journal Gives No Identifier" } })
    expect(added.status).toBe(201)
    const found = await request(`/papers?${new URLSearchParams({ url })}`, { token })
    expect(found.body.paper).toMatchObject({ id: added.body.paper.id })
    const byTitle = await request(`/papers?${new URLSearchParams({ url: "https://mirror.example.org/margins", title: "Notes toward a theory of margins" })}`, { token })
    expect(byTitle.body.paper).toMatchObject({ id: "doi-10.1000-margins.7" })
    // A page naming another DOI isn't taken for a paper with the same title
    const other = await request(`/papers?${new URLSearchParams({ doi: "10.1000/other.1", title: "Notes Toward a Theory of Margins" })}`, { token })
    expect(other.body.paper).toBeNull()
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
    await eventually(async () => expect(await call("extension.get")).toMatchObject({ serving: true, portTaken: false }))
  })

  describe("fetching for owlit", () => {
    const SAGE = "10.1177/0956797620904990"
    const id = "doi-10.1177-0956797620904990"
    const title = "Sleep Deprivation and False Memories of a Very Particular Kind"
    const acquisitionOf = (root: string) => JSON.parse(readFileSync(path.join(root, "library/papers", id, "acquisition.json"), "utf8"))

    const paperIn = async (call: (method: string) => Promise<any>) => (await call("library.list")).papers.find((p: { id: string }) => p.id === id)

    async function connected() {
      const shown: Opened[1][] = []
      const s = await setup({ holdMs: 20, shown })
      const token = await s.pair()
      s.putPaper(id, { title, ids: { doi: SAGE } })
      // Asking for work is what makes the extension connected
      expect((await s.request("/work", { token })).body).toEqual({ work: [], waits: [], open: [] })
      return { ...s, token, shown }
    }

    it("hands a paper the plain routes missed to the extension, and takes its PDF", async () => {
      const { call, request, token, root } = await connected()
      const looked = await call("library.fetchPdf", { id })
      // owlit is still finding it: the extension has it now
      expect(looked.pdfState).toMatchObject({ state: "finding", extension: { host: "sagepub.com" } })
      const { body } = await request("/work", { token })
      expect(body.work).toEqual([{ id: expect.any(String), paperId: id, url: `https://journals.sagepub.com/doi/${SAGE}`, pdfUrl: `https://journals.sagepub.com/doi/pdf/${SAGE}`, host: "sagepub.com", proxied: false }])
      const [item] = body.work
      const put = await request(`/work/${item.id}?host=journals.sagepub.com`, { token, bytes: pdfOf([`https://doi.org/${SAGE}`, title]) })
      expect(put).toMatchObject({ status: 200, body: { paper: { id, hasPdf: true } } })
      expect(acquisitionOf(root).tried.at(-1)).toMatchObject({ by: "extension", ended: "pdf", route: "extension:journals.sagepub.com" })
      // Answered once
      expect((await request(`/work/${item.id}`, { token, body: { ended: "no-copy", host: "x" } })).status).toBe(404)
    })

    it("waits for one sign-in at a site, then goes on there", async () => {
      const { call, request, token, shown } = await connected()
      await call("library.fetchPdf", { id })
      const [item] = (await request("/work", { token })).body.work
      const noted = await request(`/work/${item.id}`, { token, body: { ended: "sign-in", host: "journals.sagepub.com", title: "Sign in", url: "https://journals.sagepub.com/action/showLogin" } })
      expect(noted.status).toBe(200)
      const view = await call("extension.get")
      expect(view.waits).toEqual([{ kind: "sign-in", host: "sagepub.com", papers: 1, url: "https://journals.sagepub.com/action/showLogin", askedFor: true, proxied: false }])
      const paper = await paperIn(call)
      expect(paper.pdfState).toMatchObject({ state: "finding", reason: { by: "extension", ended: "sign-in" }, extension: { host: "sagepub.com", waits: "sign-in" } })
      // The extension knows where to watch for the user getting through
      expect((await request("/work", { token })).body).toEqual({ work: [], waits: [{ kind: "sign-in", host: "sagepub.com", papers: 1, proxied: false }], open: [] })
      // The line's Sign in: the extension that met it opens the page, in its own browser
      expect(await call("extension.open", { kind: "sign-in", host: "sagepub.com" })).toEqual({ by: "extension", browser: "Chrome" })
      expect((await request("/work", { token })).body.open).toEqual([{ kind: "sign-in", host: "sagepub.com", url: "https://journals.sagepub.com/action/showLogin" }])
      // and owlit brings that browser to the front, which the extension can't do from inside it
      expect(shown).toEqual([{ name: "Chrome" }])
      // Handed over once
      expect((await request("/work", { token })).body.open).toEqual([])
      expect((await request("/work/resume", { token, body: { host: "journals.sagepub.com" } })).body).toEqual({ resumed: true })
      expect((await call("extension.get")).waits).toEqual([])
      const again = (await request("/work", { token })).body.work
      expect(again).toMatchObject([{ paperId: id }])
    })

    it("opens a sign-in in the paired browser while no extension asks for work", async () => {
      const opened: Opened[] = []
      const s = await setup({ holdMs: 20, opened })
      const token = await s.pair("Arc")
      s.putPaper(id, { title, ids: { doi: SAGE } })
      await s.request("/work", { token })
      await s.call("library.fetchPdf", { id })
      const [item] = (await s.request("/work", { token })).body.work
      await s.request(`/work/${item.id}`, { token, body: { ended: "sign-in", host: "journals.sagepub.com", url: "https://journals.sagepub.com/action/showLogin" } })
      // The browser was closed a while ago: its extension asks for nothing
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now + 2 * 60_000)
      expect(await s.call("extension.open", { kind: "sign-in", host: "sagepub.com" })).toEqual({ by: "browser", browser: "Arc" })
      expect(opened).toEqual([["https://journals.sagepub.com/action/showLogin", { name: "Arc" }]])
      // Being allowed to read a site can't be asked from outside the browser
      expect(await s.call("extension.open", { kind: "permission", host: "sagepub.com" })).toEqual({ by: "none" })
      vi.restoreAllMocks()
    })

    it("never opens a page the extension names that isn't a web page", async () => {
      const opened: Opened[] = []
      const s = await setup({ holdMs: 20, opened })
      const token = await s.pair("Arc")
      s.putPaper(id, { title, ids: { doi: SAGE } })
      await s.request("/work", { token })
      await s.call("library.fetchPdf", { id })
      const [item] = (await s.request("/work", { token })).body.work
      await s.request(`/work/${item.id}`, { token, body: { ended: "sign-in", host: "journals.sagepub.com", url: "file:///Users/x/Results.terminal" } })
      const now = Date.now()
      vi.spyOn(Date, "now").mockReturnValue(now + 2 * 60_000)
      await s.call("extension.open", { kind: "sign-in", host: "sagepub.com" })
      expect(opened.map(([url]) => url)).not.toContainEqual(expect.stringMatching(/^file:/))
      vi.restoreAllMocks()
    })

    it("takes a site's waiting line away once its papers got their PDF another way or left", async () => {
      const { call, request, token, putPaper, root } = await connected()
      const other = { id: "doi-10.1177-0000002", doi: "10.1177/0000002" }
      putPaper(other.id, { title: "Another Paper", ids: { doi: other.doi } })
      for (const paperId of [id, other.id]) {
        await call("library.fetchPdf", { id: paperId })
        const [item] = (await request("/work", { token })).body.work
        await request(`/work/${item.id}`, { token, body: { ended: "sign-in", host: "journals.sagepub.com" } })
      }
      expect((await call("extension.get")).waits).toMatchObject([{ host: "sagepub.com", papers: 2 }])
      // The user drops the PDF they found
      const dropped = path.join(root, "found.pdf")
      writeFileSync(dropped, pdfOf([`https://doi.org/${SAGE}`, title]))
      await call("library.attachPdf", { id, path: dropped })
      expect((await call("extension.get")).waits).toMatchObject([{ host: "sagepub.com", papers: 1 }])
      await call("library.remove", { ids: [other.id] })
      expect((await call("extension.get")).waits).toEqual([])
    })

    it("keeps the PDF the user dropped while the extension's was on its way", async () => {
      const { call, request, token, root, core, server } = await connected()
      await call("library.fetchPdf", { id })
      const [item] = (await request("/work", { token })).body.work
      const library = (core as unknown as { workspace: { library: { isPdfOf: (...args: unknown[]) => Promise<string> } } }).workspace.library
      const theirs = pdfOf([`https://doi.org/${SAGE}`, title, "The copy the user found"])
      // The user's drop lands after owlit read the extension's upload, before it is placed
      const isPdfOf = library.isPdfOf.bind(library)
      vi.spyOn(library, "isPdfOf").mockImplementation(async (...args) => {
        await call("library.attachPdf", { id, path: path.join(root, "found.pdf") })
        return isPdfOf(...args)
      })
      writeFileSync(path.join(root, "found.pdf"), theirs)
      const sent = await request(`/work/${item.id}?host=journals.sagepub.com`, { token, bytes: pdfOf([`https://doi.org/${SAGE}`, title]) })
      expect(sent).toMatchObject({ status: 409, body: { reason: "has-pdf", paper: { id, hasPdf: true } } })
      expect(readFileSync(path.join(root, "library/papers", id, "paper.pdf"))).toEqual(theirs)
      expect(acquisitionOf(root).tried.at(-1)).toMatchObject({ by: "person", ended: "pdf" })
      expect(server.work.paperOf(item.id)).toBeUndefined()
    })

    it("notes each word the extension brings back as its try", async () => {
      const { call, request, token, root } = await connected()
      for (const ended of ["no-access", "not-offered", "not-there", "no-copy"] as const) {
        await call("library.fetchPdf", { id })
        const [item] = (await request("/work", { token })).body.work
        await request(`/work/${item.id}`, { token, body: { ended, host: "journals.sagepub.com", title: "Get access" } })
        expect(acquisitionOf(root).tried.at(-1)).toMatchObject({ by: "extension", ended, host: "journals.sagepub.com" })
        const paper = await paperIn(call)
        // Its word outranks owlit's own no copy, which came before it
        expect(paper.pdfState).toMatchObject({ state: "no-pdf", reason: { by: "extension", ended } })
        expect(paper.pdfState.extension).toBeUndefined()
      }
      expect((await request("/work/nothing-like-it", { token, body: { ended: "no-copy", host: "x" } })).status).toBe(404)
    })

    it("counts another paper's PDF as no copy there", async () => {
      const { call, request, token, root } = await connected()
      await call("library.fetchPdf", { id })
      const [item] = (await request("/work", { token })).body.work
      const wrong = await request(`/work/${item.id}?host=journals.sagepub.com`, { token, bytes: pdfOf(["https://doi.org/10.1000/other.paper", "Something Else Entirely, A Study of Other Things"]) })
      expect(wrong).toMatchObject({ status: 422, body: { reason: "not-this-paper" } })
      expect(acquisitionOf(root).tried.at(-1)).toMatchObject({ by: "extension", ended: "no-copy", host: "journals.sagepub.com" })
    })

    it("lets go of a fetch whose PDF owlit couldn't take, so the site goes on", async () => {
      const { call, request, token, root, server } = await connected()
      await call("library.fetchPdf", { id })
      const [item] = (await request("/work", { token })).body.work
      // A server that sent a line before the PDF's mark
      const sent = await request(`/work/${item.id}?host=journals.sagepub.com`, { token, bytes: Buffer.concat([Buffer.from("\n"), pdfOf([`https://doi.org/${SAGE}`, title])]) })
      expect(sent).toMatchObject({ status: 415, body: { reason: "not-a-pdf" } })
      expect(server.work.paperOf(item.id)).toBeUndefined()
      expect(acquisitionOf(root).tried.at(-1)).toMatchObject({ by: "extension", ended: "no-copy", host: "journals.sagepub.com" })
      // The next paper there is handed out now, not after the extension's answer is given up on
      await call("library.fetchPdf", { id })
      expect((await request("/work", { token })).body.work).toMatchObject([{ paperId: id }])
    })

    // A paper's acquisition.json as an earlier run of owlit left it
    const acquired = (root: string, paperId: string, state: string, tried: object[]) =>
      writeFileSync(path.join(root, "library/papers", paperId, "acquisition.json"), JSON.stringify({ version: 2, state, tried, dropHere: path.join(root, "library/papers", paperId, "paper.pdf") }))

    it("hands over every paper waiting for it once the extension connects, the longest waiting first", async () => {
      const s = await setup({ holdMs: 20 })
      const sage = (n: string) => ({ id: `doi-10.1177-${n}`, doi: `10.1177/${n}` })
      const [older, newer, signIn, judged, had] = ["0001", "0002", "0003", "0004", "0005"].map(sage)
      for (const p of [older, newer, signIn, judged, had]) s.putPaper(p.id, { title: `Paper ${p.doi}`, ids: { doi: p.doi } })
      // Minutes ago, so no daily look is due for any of them
      const at = (minutes: number) => Date.now() - minutes * 60_000
      // owlit's own routes found no copy, before any extension was connected (an older one first)
      acquired(s.root, newer.id, "no-pdf", [{ by: "search", ended: "no-copy", at: at(20) }])
      acquired(s.root, older.id, "no-pdf", [{ by: "search", ended: "no-copy", at: at(30) }])
      // Waiting at its site for the user's sign-in when owlit quit
      acquired(s.root, signIn.id, "finding", [{ by: "search", ended: "no-copy", at: at(40) }, { by: "extension", ended: "sign-in", at: at(10), host: "journals.sagepub.com" }])
      // The extension already saw the paywall: left to the back-off look
      acquired(s.root, judged.id, "no-pdf", [{ by: "search", ended: "no-copy", at: at(50) }, { by: "extension", ended: "no-access", at: at(45) }])
      // Has its PDF
      writeFileSync(path.join(s.root, "library/papers", had.id, "paper.pdf"), pdfOf([had.doi]))
      acquired(s.root, had.id, "have-it", [{ by: "search", ended: "no-copy", at: at(60) }, { by: "person", ended: "pdf", at: at(59) }])
      const token = await s.pair()
      const order: string[] = []
      for (let i = 0; i < 3; i++) {
        const item = await eventually(async () => {
          const [next] = (await s.request("/work", { token })).body.work
          expect(next).toBeDefined()
          return next
        })
        order.push(item.paperId)
        // Each is finding again while the extension has it, not "No PDF"
        if (i === 0) await eventually(async () => expect((await s.call("library.list")).papers.find((p: { id: string }) => p.id === newer.id).pdfState).toMatchObject({ state: "finding", extension: { host: "sagepub.com" } }))
        await s.request(`/work/${item.id}`, { token, body: { ended: "no-copy", host: "journals.sagepub.com" } })
      }
      expect(order).toEqual([older.id, newer.id, signIn.id])
      expect((await s.request("/work", { token })).body.work).toEqual([])
    })

    it("hands the daily look's miss to the extension, as Look again does", async () => {
      const { root, request, token, core } = await connected()
      // The extension found no copy before; the back-off look is due again
      acquired(root, id, "no-pdf", [{ by: "search", ended: "no-copy", at: 1 }, { by: "extension", ended: "no-copy", at: 2 }])
      const workspace = (core as unknown as { workspace: { tasks: { enqueue(kind: string, subject: string, priority: string): { id: string }; wait(id: string): Promise<unknown> } } }).workspace
      // What the daily look queues for a paper whose look is due
      await workspace.tasks.wait(workspace.tasks.enqueue("paper.pdf", id, "background").id)
      const [item] = (await request("/work", { token })).body.work
      expect(item).toMatchObject({ paperId: id, host: "sagepub.com" })
      expect(acquisitionOf(root).tried.at(-1)).toMatchObject({ by: "search", ended: "no-copy" })
    })

    it("leaves a paper to owlit's own ways while no extension asks for work", async () => {
      const s = await setup({ holdMs: 20 })
      s.putPaper(id, { title, ids: { doi: SAGE } })
      const looked = await s.call("library.fetchPdf", { id })
      expect(looked.pdfState).toMatchObject({ state: "no-pdf" })
      expect(looked.pdfState.extension).toBeUndefined()
    })
  })
})
