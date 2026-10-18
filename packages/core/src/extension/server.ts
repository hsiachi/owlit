import { t } from "@lingui/core/macro"
import { EXTENSION_PORT, OWLIT_ID_HEADER, OWLIT_NAME_HEADER, RpcErrorCode, type ExtensionOpened, type ExtensionStatus, type ExtensionView, type ExtensionWait, type OwlitIdentity, type PairAnswer, type PairStarted, type PaperAnswer, type StoredPairing, type WorkAnswer } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { z } from "zod"
import type { Library, PlacedBy } from "../library/library.ts"
import { RpcFailure } from "../rpc/index.ts"
import { PDF_MAX_BYTES } from "../library/pdf.ts"
import type { SettingsStore } from "../settings.ts"
import type { BrowserApp } from "./browser-app.ts"
import { asHttpFailure, HttpFailure, readJson, readToFile, removeQuietly, send } from "./http.ts"
import { HOLD_MS, Pairings } from "./pairings.ts"
import { addBody, addPaper, findPaper, shown, startsAsPdf } from "./papers.ts"
import { clean } from "../util.ts"
import { ExtensionWork, type WorkOptions } from "./work.ts"

// owlit's browser extension reaches core here: plain HTTP on 127.0.0.1, one fixed port per machine (the
// way Zotero's connector reaches Zotero). A browser asks only for what an extension may: every request
// must come from an extension (its origin, or EXTENSION_HEADER where the browser sends no origin), and
// every route but /pair needs the token the user allowed it to have. The server never serves a file, and takes nothing larger than a PDF owlit would download.
//
// One per Core, not per workspace: the extension stays paired while workspaces switch, and the paper
// routes answer for whichever workspace is open.

// Origins a browser gives an extension's own requests: Chromium's, Firefox's, Safari's
const EXTENSION_ORIGIN = /^(chrome-extension|moz-extension|safari-web-extension):\/\/[\w.-]+$/
// Chromium sends no Origin with an extension's GET to a site it has permission for, so the extension
// names itself in this header instead. A web page can't send it: a page's request that carries a header
// of its own needs a preflight first, and the preflight is refused.
export const EXTENSION_HEADER = "x-owlit-extension"
// While another program holds the port (another owlit open beside this one), owlit tries again this often,
// so it takes over once the other quits
export const RETRY_MS = 30_000

export interface ExtensionHost {
  version: string
  // This owlit's name as the menu bar says it: Owlit, or Owlit Dev (branch)
  name: string
  settings: SettingsStore
  // The open workspace's name and library
  workspace: () => { name: string; library: Library } | null
  // An owlit window is open to ask the user in
  hasWindow: () => boolean
  changed: (view: ExtensionView) => void
  // Opens a page in a pairing's browser: its app when known, else the one the extension named ("Chrome"),
  // else the system's default
  openInBrowser?: (url: string, browser: { app?: string; name?: string }) => Promise<void>
  // The browser app holding the other end of a request's connection, by its port (Host.browserApp)
  browserApp?: (remotePort: number) => Promise<BrowserApp | undefined>
}

export interface ExtensionServerOptions {
  // EXTENSION_PORT for the installed owlit, EXTENSION_DEV_PORT for one run from a checkout; 0 lets the
  // system pick (tests)
  port?: number
  // ExtensionHost.name
  name?: string
  retryMs?: number
  questionMs?: number
  holdMs?: number
  work?: WorkOptions
}

interface Request {
  method: string
  // The path's segments, decoded: /papers/x/pdf → ["papers", "x", "pdf"]
  parts: string[]
  query: URLSearchParams
  raw: IncomingMessage
  // Aborted when the extension stops waiting
  closed: AbortSignal
  // The extension asking: its Origin, or where the browser sends none, the origin it names in
  // EXTENSION_HEADER; undefined when it gave neither
  requester: string | undefined
  pairing: StoredPairing | null
}

interface Route {
  method: string
  path: (parts: string[]) => boolean
  // Answers before any pairing (POST /pair, GET /pair/:pairing)
  open?: boolean
  handle: (request: Request) => Promise<{ status?: number; body: unknown }>
}

export class ExtensionServer {
  readonly pairings: Pairings
  // The papers handed to the extension to fetch
  readonly work: ExtensionWork
  private readonly host: ExtensionHost
  private readonly options: Required<Pick<ExtensionServerOptions, "retryMs" | "holdMs">> & { port: number }
  private server: Server | null = null
  private portTaken = false
  private retry: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private readonly routes: Route[]
  private identity: Promise<OwlitIdentity> | undefined
  // Pairings from before owlit could tell the browser's app, looked up once each
  private appLooked = new Set<string>()

  constructor(host: ExtensionHost, options: ExtensionServerOptions = {}) {
    this.host = host
    this.options = { port: options.port ?? EXTENSION_PORT, retryMs: options.retryMs ?? RETRY_MS, holdMs: options.holdMs ?? HOLD_MS }
    this.pairings = new Pairings(host.settings, () => void this.announce(), { questionMs: options.questionMs })
    this.work = new ExtensionWork(
      {
        papers: (library, ids) => void library.pdfChanged(ids).catch((error) => console.error("[core] couldn't tell the window about papers with the extension", error)),
        waits: () => void this.announce(),
        connected: (library) => void library.handToExtension().catch((error) => console.error("[core] couldn't hand papers to the extension", error)),
      },
      options.work,
    )
    this.routes = this.makeRoutes()
  }

  // The port it serves on, once it does
  get port(): number | undefined {
    const address = this.server?.address()
    return address && typeof address === "object" ? address.port : undefined
  }

  async view(): Promise<ExtensionView> {
    return { ...(await this.pairings.view(!!this.server, this.portTaken)), waits: this.work.waits() }
  }

  // The id the user's extensions pair with: made once, kept in settings.json
  owlit(): Promise<OwlitIdentity> {
    this.identity ??= (async () => {
      let id = (await this.host.settings.get()).owlitId
      if (!id) {
        id = randomUUID()
        const made = id
        await this.host.settings.update((s) => ({ ...s, owlitId: s.owlitId ?? made }))
        id = (await this.host.settings.get()).owlitId!
      }
      return { id, name: this.host.name }
    })()
    return this.identity
  }

  // A waiting line's button (extension.open): the extension opens the page in its own browser, where the
  // user's access is. With none connected, owlit opens a sign-in or a check itself, in the browser of the
  // pairing that met it; being allowed to read a site can only be asked from inside the browser.
  async open(kind: ExtensionWait["kind"], host: string): Promise<ExtensionOpened> {
    const wait = this.work.waits().find((w) => w.kind === kind && w.host === host)
    if (!wait) return { by: "none" }
    const paired = (await this.host.settings.get()).extension?.paired ?? []
    const pairingOf = (id: string | undefined) => paired.find((p) => p.id === id)
    const to = this.work.open(kind, host)
    if (to) return { by: "extension", browser: pairingOf(to)?.browser }
    if (kind === "permission" || !this.host.openInBrowser) return { by: "none" }
    // The browser that met it, else the one seen last
    const pairing = pairingOf(this.work.pausedBy(host)) ?? [...paired].sort((a, b) => (b.lastSeenAt ?? b.pairedAt) - (a.lastSeenAt ?? a.pairedAt))[0]
    await this.host.openInBrowser(wait.url, clean({ app: pairing?.app, name: pairing?.browser }))
    return { by: "browser", browser: pairing?.browser }
  }

  async start() {
    this.stopped = false
    await this.listen()
  }

  async close() {
    this.stopped = true
    clearTimeout(this.retry)
    this.pairings.dispose()
    this.work.dispose()
    const server = this.server
    this.server = null
    if (!server) return
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async listen() {
    if (this.stopped || this.server) return
    const server = createServer((request, response) => void this.receive(request, response))
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject)
        server.listen(this.options.port, "127.0.0.1", () => {
          server.off("error", reject)
          resolve()
        })
      })
    } catch (error) {
      const taken = (error as NodeJS.ErrnoException).code === "EADDRINUSE"
      if (!taken) console.error("[core] couldn't open the port for the browser extension", error)
      if (this.portTaken !== taken) {
        this.portTaken = taken
        void this.announce()
      }
      this.retry = setTimeout(() => void this.listen(), this.options.retryMs)
      this.retry.unref?.()
      return
    }
    if (this.stopped) return void server.close()
    this.server = server
    this.portTaken = false
    void this.announce()
  }

  private async announce() {
    this.host.changed(await this.view())
  }

  private async receive(raw: IncomingMessage, response: ServerResponse) {
    const origin = raw.headers.origin
    // A page can't send an extension's origin, nor leave out its own; anything else (a web page, a
    // program that didn't say) is turned away before its request is read
    const fromExtension = origin === undefined ? raw.headers[EXTENSION_HEADER] !== undefined : EXTENSION_ORIGIN.test(origin)
    if (!fromExtension || !this.ownHost(raw.headers.host)) {
      send(response, 403, { reason: "not-an-extension", message: t`Only owlit's browser extension can connect here.` })
      raw.resume()
      return
    }
    // Which owlit this is, to every extension, paired or not: one paired with another owlit (the
    // installed one, while a preview has the port) tells it apart by this and keeps its pairing
    const owlit = await this.owlit()
    const named = raw.headers[EXTENSION_HEADER]
    // The browser's Origin wins: an extension can name any origin in a header, never in its Origin
    const requester = origin ?? (typeof named === "string" && EXTENSION_ORIGIN.test(named) ? named : undefined)
    const own: Record<string, string> = { [OWLIT_ID_HEADER]: owlit.id, [OWLIT_NAME_HEADER]: encodeURIComponent(owlit.name) }
    const cors: Record<string, string> = origin ? { ...own, "access-control-allow-origin": origin, "access-control-expose-headers": `${OWLIT_ID_HEADER}, ${OWLIT_NAME_HEADER}`, vary: "Origin" } : own
    if (raw.method === "OPTIONS") {
      response.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
        "access-control-allow-headers": `authorization, content-type, ${EXTENSION_HEADER}`,
        "access-control-max-age": "600",
      })
      response.end()
      return
    }
    const closed = new AbortController()
    response.on("close", () => closed.abort())
    try {
      const url = new URL(raw.url ?? "/", "http://127.0.0.1")
      const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part))
      const route = this.routes.find((r) => r.method === raw.method && r.path(parts))
      if (!route) throw new HttpFailure(404, "not-found", t`owlit doesn't know that request.`)
      let pairing: StoredPairing | null = null
      if (!route.open) {
        const token = /^Bearer\s+(\S+)$/i.exec(raw.headers.authorization ?? "")?.[1]
        pairing = (token && (await this.pairings.byToken(token, requester))) || null
        if (!pairing) throw new HttpFailure(401, "not-paired", t`This browser isn't connected to owlit. Press Connect.`)
        void this.pairings.seen(pairing).catch((error) => console.error("[core] couldn't note the extension's visit", error))
        if (!pairing.app && !this.appLooked.has(pairing.id)) {
          this.appLooked.add(pairing.id)
          const app = await this.appOf(raw)
          if (app) await this.pairings.noteApp(pairing.id, app)
        }
      }
      const answer = await route.handle({ method: raw.method ?? "GET", parts, query: url.searchParams, raw, closed: closed.signal, requester, pairing })
      send(response, answer.status ?? 200, answer.body, cors)
    } catch (error) {
      const failure = asHttpFailure(error)
      raw.resume()
      if (!response.headersSent) send(response, failure.status, { reason: failure.reason, message: failure.message, ...failure.extra }, cors)
    }
  }

  // The browser app that made this request, while its connection is open; undefined where the host
  // can't tell
  private async appOf(raw: IncomingMessage): Promise<BrowserApp | undefined> {
    const port = raw.socket.remotePort
    if (!port || !this.host.browserApp) return undefined
    return this.host.browserApp(port).catch((error) => {
      console.error("[core] couldn't tell which app the extension is in", error)
      return undefined
    })
  }

  // 127.0.0.1 or localhost at this port: a page that points its own name at 127.0.0.1 (DNS rebinding) is
  // still a page's request
  private ownHost(host: string | undefined) {
    const port = this.port
    return !!host && port !== undefined && (host === `127.0.0.1:${port}` || host === `localhost:${port}`)
  }

  private library() {
    const workspace = this.host.workspace()
    if (!workspace) throw new HttpFailure(503, "no-workspace", t`Open a workspace in owlit.`)
    return workspace.library
  }

  // Named by what they do
  private makeRoutes(): Route[] {
    const is = (...want: (string | null)[]) => (parts: string[]) => parts.length === want.length && want.every((w, i) => w === null || w === parts[i])
    const pair = z.object({ browser: z.string().trim().min(1).max(60), extensionVersion: z.string().max(40).optional() })
    const host = z.string().trim().min(1).max(253)
    const ended = z.object({
      ended: z.enum(["no-copy", "no-access", "not-offered", "not-there", "check", "sign-in", "offline", "no-permission"]),
      host,
      title: z.string().max(500).optional(),
      // Only a web page: the url may be opened in a browser later, and `open` would run a file: or app link
      url: z
        .string()
        .max(4096)
        .optional()
        .transform((url) => (url && /^https?:\/\//i.test(url) ? url : undefined)),
    })
    return [
      {
        method: "POST",
        path: is("pair"),
        open: true,
        handle: async ({ raw, requester }) => {
          const body = pair.safeParse(await readJson(raw))
          if (!body.success) throw new HttpFailure(400, "bad-request", t`owlit couldn't read what the extension sent.`)
          if (!this.host.hasWindow()) throw new HttpFailure(503, "no-window", t`Open the owlit window, then press Connect again.`)
          // The app the system says made the request is named over the one the extension says it is in
          const app = await this.appOf(raw)
          return { status: 202, body: this.pairings.ask(app?.name ?? body.data.browser, requester, app?.id) satisfies PairStarted }
        },
      },
      {
        method: "GET",
        path: is("pair", null),
        open: true,
        handle: async ({ parts, closed, requester }) => {
          const answer = await this.pairings.wait(parts[1], this.options.holdMs, closed, requester)
          return { body: (answer.state === "allowed" ? { ...answer, owlit: await this.owlit() } : answer) satisfies PairAnswer }
        },
      },
      {
        method: "GET",
        path: is("status"),
        handle: async ({ pairing }) => {
          const workspace = this.host.workspace()
          return { body: { version: this.host.version, workspace: workspace ? { name: workspace.name } : null, connectedAt: pairing!.pairedAt, owlit: await this.owlit() } satisfies ExtensionStatus }
        },
      },
      {
        method: "GET",
        path: is("papers"),
        handle: async ({ query }) => {
          const page = { doi: query.get("doi") ?? undefined, arxiv: query.get("arxiv") ?? undefined, url: query.get("url") ?? undefined, title: query.get("title") ?? undefined }
          const paper = await findPaper(this.library(), page)
          return { body: { paper: paper ? shown(paper) : null } }
        },
      },
      {
        method: "POST",
        path: is("papers"),
        handle: async ({ raw }) => {
          const body = addBody.safeParse(await readJson(raw))
          if (!body.success) throw new HttpFailure(400, "bad-request", t`owlit couldn't read what the extension sent.`)
          const { paper, existed } = await addPaper(this.library(), body.data)
          return { status: existed ? 200 : 201, body: { paper: shown(paper) } satisfies PaperAnswer }
        },
      },
      {
        method: "PUT",
        path: is("papers", null, "pdf"),
        handle: async ({ raw, parts }) => {
          const library = this.library()
          const before = await library.get(parts[1])
          if (!before) throw new HttpFailure(404, "not-found", t`That paper is not in the library.`)
          if (before.pdf) throw new HttpFailure(409, "has-pdf", t`This paper has its PDF already.`, { paper: shown(before) })
          return this.withPdf(raw, async (file) => {
            if ((await library.isPdfOf(before.id, file)) === "no") throw new HttpFailure(422, "not-this-paper", t`This isn't the paper's PDF.`)
            return { body: { paper: shown(await this.attachIfMissing(library, before.id, file, "extension")) } satisfies PaperAnswer }
          })
        },
      },
      // The papers due for fetching now; held open a while when none is. Asking is what keeps the
      // extension connected (ExtensionWork.connected)
      {
        method: "GET",
        path: is("work"),
        handle: async ({ closed, pairing }) => {
          const work = await this.work.take(this.host.workspace()?.library ?? null, this.options.holdMs, closed, pairing!.id)
          return { body: { work, waits: this.work.waitsForExtension(), open: this.work.takeOpens(pairing!.id) } satisfies WorkAnswer }
        },
      },
      {
        method: "POST",
        path: is("work", "resume"),
        handle: async ({ raw }) => {
          const body = z.object({ host }).safeParse(await readJson(raw))
          if (!body.success) throw new HttpFailure(400, "bad-request", t`owlit couldn't read what the extension sent.`)
          return { body: { resumed: this.work.resume(body.data.host) } }
        },
      },
      // How a fetch ended: the PDF itself, or a word for what came instead
      {
        method: "POST",
        path: is("work", null),
        handle: async ({ raw, parts, query }) => {
          const id = parts[1]
          const found = this.work.paperOf(id)
          if (!found) {
            raw.resume()
            throw new HttpFailure(404, "not-found", t`owlit isn't waiting for that.`)
          }
          const { library, paper } = found
          const before = await library.get(paper.paperId)
          // Gone from the Library, or given its PDF another way meanwhile: nothing more to fetch
          if (!before || before.pdf) {
            raw.resume()
            this.work.settle(id, undefined)
            if (!before) throw new HttpFailure(404, "not-found", t`That paper is not in the library.`)
            throw new HttpFailure(409, "has-pdf", t`This paper has its PDF already.`, { paper: shown(before) })
          }
          if (/^application\/pdf\b/i.test(raw.headers["content-type"] ?? "")) {
            const at = query.get("host")?.trim() || paper.host
            try {
              return await this.withPdf(raw, async (file) => {
                // Another paper's PDF (a publisher's page can link the wrong one): no copy there
                if ((await library.isPdfOf(paper.paperId, file)) === "no") throw new HttpFailure(422, "not-this-paper", t`This isn't the paper's PDF.`)
                const placed = await this.attachIfMissing(library, paper.paperId, file, `extension:${at}`)
                this.work.settle(id, undefined)
                return { body: { paper: shown(placed) } satisfies PaperAnswer }
              })
            } catch (error) {
              // A body owlit couldn't take (not a PDF to owlit, too large, another paper's, a failure
              // placing it) is no copy there. The item is settled whatever failed: the extension doesn't
              // answer again, and an item left in flight holds back every other paper of its site.
              await library.noteExtensionTry(paper.paperId, { by: "extension", ended: "no-copy", at: Date.now(), host: at }).catch((noting) => console.error("[core] couldn't note the extension's try", noting))
              this.work.settle(id, "no-copy")
              throw error
            }
          }
          const body = ended.safeParse(await readJson(raw))
          if (!body.success) throw new HttpFailure(400, "bad-request", t`owlit couldn't read what the extension sent.`)
          const { ended: word, host: at, title, url } = body.data
          await library.noteExtensionTry(paper.paperId, clean({ by: "extension" as const, ended: word, at: Date.now(), host: at, title: title?.trim() || undefined }))
          this.work.settle(id, word, { url })
          return { body: { noted: true } }
        },
      },
      {
        method: "PUT",
        path: is("pdfs"),
        handle: async ({ raw }) => {
          const library = this.library()
          return this.withPdf(raw, async (file) => {
            const paper = await library.attachUnnamedPdf(file, "extension").catch((error) => {
              // Given its PDF another way while this one was read: it isn't missing any more
              if (error instanceof RpcFailure && error.code === RpcErrorCode.Conflict) return undefined
              throw error
            })
            // Not a paper the Library is waiting on: the file goes, and nothing is offered on a guess
            if (!paper) throw new HttpFailure(404, "not-a-library-paper", t`This PDF isn't one your Library is missing.`)
            return { body: { paper: shown(paper) } satisfies PaperAnswer }
          })
        },
      },
    ]
  }

  // The extension's PDF as the paper's, unless one is there by now: the check before the upload was read
  // can't see a PDF the user dropped meanwhile, so it is made again under the library's lock
  private async attachIfMissing(library: Library, id: string, file: string, route: PlacedBy) {
    try {
      return await library.attachPdf(id, file, route, { ifMissing: true })
    } catch (error) {
      if (!(error instanceof RpcFailure) || error.code !== RpcErrorCode.Conflict) throw error
      const now = await library.get(id)
      throw new HttpFailure(409, "has-pdf", t`This paper has its PDF already.`, now ? { paper: shown(now) } : undefined)
    }
  }

  // The request's PDF in a temp file for as long as work needs it
  private async withPdf<T>(raw: IncomingMessage, work: (file: string) => Promise<T>): Promise<T> {
    const file = await readToFile(raw, PDF_MAX_BYTES)
    try {
      if (!(await startsAsPdf(file))) throw new HttpFailure(415, "not-a-pdf", t`That isn't a PDF.`)
      return await work(file)
    } finally {
      await removeQuietly(file)
    }
  }
}
