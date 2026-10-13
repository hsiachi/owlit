import { SHARE_LIMITS, type ShareAnchor, type ShareBundle, type ShareComment, type SharePermission, type ShareView } from "@owlit/protocol"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import type { Store } from "./store.ts"

// The share server's HTTP side. owlit creates a share and pushes its bundle with the key it got back;
// readers fetch the bundle, follow changes over server-sent events and post comments. It also serves the
// reader's page (apps/share-web, built) at /s/<id>.

export interface ShareServerOptions {
  store: Store
  // Where links point, e.g. https://share.example.org (no trailing slash)
  publicUrl: string
  // apps/share-web's build; without it only the API answers
  staticDir?: string
  // Take the client's address from X-Forwarded-For (behind a reverse proxy)
  trustProxy?: boolean
  now?: () => number
}

const COMMENTS_PER_SHARE = 2000
// Requests per address in a window: making shares, posting comments
const RATES = {
  create: { count: 30, windowMs: 60 * 60_000 },
  comment: { count: 40, windowMs: 10 * 60_000 },
} as const
const HEARTBEAT_MS = 25_000

class HttpFailure extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const newId = (bytes: number) => randomBytes(bytes).toString("base64url")
const hash = (token: string) => createHash("sha256").update(token).digest("hex")
const SHARE_ID = /^[A-Za-z0-9_-]{16,64}$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function checkBundle(value: unknown): ShareBundle {
  if (!isRecord(value) || value.version !== 1 || typeof value.title !== "string" || typeof value.markdown !== "string" || !isRecord(value.papers)) {
    throw new HttpFailure(400, "The bundle isn't one this server reads.")
  }
  for (const paper of Object.values(value.papers)) {
    if (!isRecord(paper) || typeof paper.id !== "string" || typeof paper.title !== "string" || !Array.isArray(paper.authors)) {
      throw new HttpFailure(400, "A paper in the bundle isn't one this server reads.")
    }
  }
  return value as unknown as ShareBundle
}

const checkPermission = (value: unknown): SharePermission => {
  if (value === "comment" || value === "view") return value
  throw new HttpFailure(400, "permission is comment or view.")
}

function checkAnchor(value: unknown): ShareAnchor | null {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.quote !== "string" || typeof value.prefix !== "string" || typeof value.suffix !== "string") {
    throw new HttpFailure(400, "The comment's passage isn't one this server reads.")
  }
  if (!value.quote.trim() || value.quote.length > SHARE_LIMITS.quote) throw new HttpFailure(400, "The passage is empty or too long.")
  return { quote: value.quote, prefix: value.prefix.slice(-64), suffix: value.suffix.slice(0, 64) }
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpFailure(413, "That is more than this server takes.")
    chunks.push(chunk as Buffer)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new HttpFailure(400, "The body isn't JSON.")
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".json": "application/json",
}

// The reader's page loads only from here; images in a doc may come from the web. A link out never says
// where it came from, so the share's address doesn't travel in Referer.
const PAGE_HEADERS = {
  "content-security-policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
}

export function createShareServer(options: ShareServerOptions) {
  const { store } = options
  const now = options.now ?? Date.now
  const listeners = new Map<string, Set<ServerResponse>>()
  const hits = new Map<string, number[]>()

  const clientOf = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : ""
    return forwarded || req.socket.remoteAddress || "?"
  }

  // Sliding window per address and kind
  const limit = (req: IncomingMessage, kind: keyof typeof RATES) => {
    const { count, windowMs } = RATES[kind]
    const key = `${kind}:${clientOf(req)}`
    const t = now()
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs)
    if (recent.length >= count) throw new HttpFailure(429, "Too many requests from here; try again a little later.")
    recent.push(t)
    hits.set(key, recent)
  }

  const isAuthor = (req: IncomingMessage, tokenHash: string) => {
    const header = String(req.headers.authorization ?? "")
    const token = /^Bearer (.+)$/.exec(header)?.[1]
    if (!token) return false
    const a = Buffer.from(hash(token))
    const b = Buffer.from(tokenHash)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  const shareFor = (id: string) => {
    const row = SHARE_ID.test(id) ? store.share(id) : undefined
    if (!row) throw new HttpFailure(404, "There is no share at this link.")
    return row
  }

  const requireAuthor = (req: IncomingMessage, id: string) => {
    const row = shareFor(id)
    if (!isAuthor(req, row.tokenHash)) throw new HttpFailure(403, "Only the author can change this share.")
    return row
  }

  const send = (shareId: string, event: string, data: unknown) => {
    for (const res of listeners.get(shareId) ?? []) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" })
    res.end(JSON.stringify(body))
  }

  async function serveStatic(res: ServerResponse, urlPath: string) {
    const dir = options.staticDir
    if (!dir) throw new HttpFailure(404, "Not found.")
    // Every page is the reader's one page; its files are under /assets
    const page = urlPath === "/" || /^\/s\/[A-Za-z0-9_-]+\/?$/.test(urlPath)
    const rel = page ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "")
    const file = path.resolve(dir, rel)
    if (file !== path.resolve(dir) && !file.startsWith(path.resolve(dir) + path.sep)) throw new HttpFailure(404, "Not found.")
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) throw new HttpFailure(404, "Not found.")
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream"
    res.writeHead(200, {
      "content-type": type,
      "content-length": info.size,
      // Built files carry a hash in their name; the page itself is always asked again
      "cache-control": page ? "no-cache" : "public, max-age=31536000, immutable",
      ...(page ? PAGE_HEADERS : { "x-content-type-options": "nosniff" }),
    })
    createReadStream(file).pipe(res)
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://share.local")
    const parts = url.pathname.split("/").filter(Boolean)
    const method = req.method ?? "GET"

    if (url.pathname === "/healthz") return json(res, 200, { ok: true })
    if (parts[0] !== "api") {
      if (method !== "GET" && method !== "HEAD") throw new HttpFailure(405, "Method not allowed.")
      return serveStatic(res, url.pathname)
    }
    if (parts[1] !== "shares") throw new HttpFailure(404, "Not found.")
    const [, , id, sub, commentId] = parts

    if (!id) {
      if (method !== "POST") throw new HttpFailure(405, "Method not allowed.")
      limit(req, "create")
      const body = await readBody(req, SHARE_LIMITS.bundle + 1024)
      if (!isRecord(body)) throw new HttpFailure(400, "The body isn't an object.")
      const bundle = checkBundle(body.bundle)
      const permission = body.permission === undefined ? "comment" : checkPermission(body.permission)
      const shareId = newId(16)
      const token = newId(32)
      const t = now()
      store.createShare({ id: shareId, tokenHash: hash(token), bundle: JSON.stringify(bundle), permission, createdAt: t, updatedAt: t })
      return json(res, 201, { id: shareId, token, url: `${options.publicUrl}/s/${shareId}` })
    }

    if (!sub) {
      if (method === "GET") {
        const row = shareFor(id)
        if (row.stoppedAt) return json(res, 410, { error: "The author stopped sharing this.", stopped: true })
        const view: ShareView = { id: row.id, bundle: JSON.parse(row.bundle) as ShareBundle, permission: row.permission, updatedAt: row.updatedAt }
        return json(res, 200, view)
      }
      if (method === "PUT") {
        const row = requireAuthor(req, id)
        if (row.stoppedAt) throw new HttpFailure(410, "This share was stopped.")
        const body = await readBody(req, SHARE_LIMITS.bundle + 1024)
        if (!isRecord(body)) throw new HttpFailure(400, "The body isn't an object.")
        const change: { bundle?: string; permission?: SharePermission } = {}
        if (body.bundle !== undefined) change.bundle = JSON.stringify(checkBundle(body.bundle))
        if (body.permission !== undefined) change.permission = checkPermission(body.permission)
        const t = now()
        store.updateShare(id, change, t)
        send(id, "update", { updatedAt: t, permission: change.permission ?? row.permission })
        return json(res, 200, { updatedAt: t })
      }
      if (method === "DELETE") {
        const row = requireAuthor(req, id)
        if (!row.stoppedAt) {
          store.stopShare(id, now())
          send(id, "stopped", {})
        }
        res.writeHead(204).end()
        return
      }
      throw new HttpFailure(405, "Method not allowed.")
    }

    if (sub === "events" && method === "GET") {
      const row = shareFor(id)
      if (row.stoppedAt) return json(res, 410, { error: "The author stopped sharing this.", stopped: true })
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" })
      res.write(": hello\n\n")
      const set = listeners.get(id) ?? new Set()
      set.add(res)
      listeners.set(id, set)
      const beat = setInterval(() => res.write(": beat\n\n"), HEARTBEAT_MS)
      req.on("close", () => {
        clearInterval(beat)
        set.delete(res)
        if (!set.size) listeners.delete(id)
      })
      return
    }

    if (sub === "comments" && !commentId) {
      const row = shareFor(id)
      const author = isAuthor(req, row.tokenHash)
      // The author still reads the comments of a stopped share; readers can't
      if (row.stoppedAt && !author) return json(res, 410, { error: "The author stopped sharing this.", stopped: true })
      if (method === "GET") return json(res, 200, store.comments(id))
      if (method !== "POST") throw new HttpFailure(405, "Method not allowed.")
      if (row.stoppedAt) throw new HttpFailure(410, "This share was stopped.")
      if (!author && row.permission !== "comment") throw new HttpFailure(403, "This share can be read but not commented on.")
      if (!author) limit(req, "comment")
      if (store.countComments(id) >= COMMENTS_PER_SHARE) throw new HttpFailure(429, "This share has as many comments as it can hold.")
      const body = await readBody(req, 64 * 1024)
      if (!isRecord(body)) throw new HttpFailure(400, "The body isn't an object.")
      const text = typeof body.text === "string" ? body.text.trim() : ""
      const name = typeof body.name === "string" ? body.name.trim() : ""
      if (!text || text.length > SHARE_LIMITS.comment) throw new HttpFailure(400, "The comment is empty or too long.")
      if (!name || name.length > SHARE_LIMITS.name) throw new HttpFailure(400, "Say who you are, in a short name.")
      let parent: string | undefined
      let anchor: ShareAnchor | null = null
      if (typeof body.parent === "string" && body.parent) {
        const of = store.comment(id, body.parent)
        if (!of) throw new HttpFailure(400, "The comment this answers isn't there.")
        // Replies hang off the first comment, so a thread is one level deep
        parent = of.parent ?? of.id
      } else anchor = checkAnchor(body.anchor)
      if (!parent && !anchor) throw new HttpFailure(400, "A comment is on a passage or answers another comment.")
      const comment: ShareComment = { id: newId(9), anchor, ...(parent ? { parent } : {}), name, by: author ? "author" : "reader", text, at: now() }
      store.addComment(id, comment)
      send(id, "comments", { id: comment.id })
      return json(res, 201, comment)
    }

    if (sub === "comments" && commentId && method === "PATCH") {
      requireAuthor(req, id)
      const body = await readBody(req, 1024)
      if (!isRecord(body) || typeof body.resolved !== "boolean") throw new HttpFailure(400, "resolved is true or false.")
      if (!store.comment(id, commentId)) throw new HttpFailure(404, "There is no such comment.")
      store.setResolved(id, commentId, body.resolved)
      send(id, "comments", { id: commentId })
      res.writeHead(204).end()
      return
    }

    throw new HttpFailure(404, "Not found.")
  }

  async function handler(req: IncomingMessage, res: ServerResponse) {
    try {
      await route(req, res)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      if (error instanceof HttpFailure) return json(res, error.status, { error: error.message })
      console.error("[share] request failed", error)
      json(res, 500, { error: "Something went wrong on the server." })
    }
  }

  // Readers following a share are told nothing more; their pages try again on their own
  function close() {
    for (const set of listeners.values()) for (const res of set) res.end()
    listeners.clear()
  }

  return { handler, close }
}
