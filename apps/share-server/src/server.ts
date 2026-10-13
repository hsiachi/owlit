import type { ShareBundle, ShareComment, ShareView } from "@owlit/protocol"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import { BODY_LIMITS, carriesKey, checkChange, checkComment, checkNewShare, checkResolve, COMMENTS_PER_SHARE, hashToken, HttpFailure, newId, PAGE_HEADERS, RATES, SHARE_ID, underRate } from "./rules.ts"
import type { Store } from "./store.ts"

// The share server's HTTP side, on plain Node (apps/share-worker is the same on Cloudflare). owlit creates a
// share and pushes its bundle with the key it got back; readers fetch the bundle, follow changes over
// server-sent events and post comments. It also serves the reader's page (apps/share-web, built) at /s/<id>.

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

const HEARTBEAT_MS = 25_000

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

export function createShareServer(options: ShareServerOptions) {
  const { store } = options
  const now = options.now ?? Date.now
  const listeners = new Map<string, Set<ServerResponse>>()
  const hits = new Map<string, number[]>()

  const clientOf = (req: IncomingMessage) => {
    const forwarded = options.trustProxy ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : ""
    return forwarded || req.socket.remoteAddress || "?"
  }

  const limit = (req: IncomingMessage, kind: keyof typeof RATES) => {
    if (!underRate(hits, `${kind}:${clientOf(req)}`, RATES[kind], now())) throw new HttpFailure(429, "Too many requests from here; try again a little later.")
  }

  const isAuthor = (req: IncomingMessage, tokenHash: string) => carriesKey(req.headers.authorization, tokenHash)

  const shareFor = (id: string) => {
    const row = SHARE_ID.test(id) ? store.share(id) : undefined
    if (!row) throw new HttpFailure(404, "There is no share at this link.")
    return row
  }

  const requireAuthor = async (req: IncomingMessage, id: string) => {
    const row = shareFor(id)
    if (!(await isAuthor(req, row.tokenHash))) throw new HttpFailure(403, "Only the author can change this share.")
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
      const { bundle, permission } = checkNewShare(await readBody(req, BODY_LIMITS.share))
      const shareId = newId(16)
      const token = newId(32)
      const t = now()
      store.createShare({ id: shareId, tokenHash: await hashToken(token), bundle: JSON.stringify(bundle), permission, createdAt: t, updatedAt: t })
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
        const row = await requireAuthor(req, id)
        if (row.stoppedAt) throw new HttpFailure(410, "This share was stopped.")
        const change = checkChange(await readBody(req, BODY_LIMITS.share))
        const t = now()
        store.updateShare(id, { ...(change.bundle ? { bundle: JSON.stringify(change.bundle) } : {}), ...(change.permission ? { permission: change.permission } : {}) }, t)
        send(id, "update", { updatedAt: t, permission: change.permission ?? row.permission })
        return json(res, 200, { updatedAt: t })
      }
      if (method === "DELETE") {
        const row = await requireAuthor(req, id)
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
      const author = await isAuthor(req, row.tokenHash)
      // The author still reads the comments of a stopped share; readers can't
      if (row.stoppedAt && !author) return json(res, 410, { error: "The author stopped sharing this.", stopped: true })
      if (method === "GET") return json(res, 200, store.comments(id))
      if (method !== "POST") throw new HttpFailure(405, "Method not allowed.")
      if (row.stoppedAt) throw new HttpFailure(410, "This share was stopped.")
      if (!author && row.permission !== "comment") throw new HttpFailure(403, "This share can be read but not commented on.")
      if (!author) limit(req, "comment")
      if (store.countComments(id) >= COMMENTS_PER_SHARE) throw new HttpFailure(429, "This share has as many comments as it can hold.")
      const body = checkComment(await readBody(req, BODY_LIMITS.comment))
      let parent: string | undefined
      if (body.parent) {
        const of = store.comment(id, body.parent)
        if (!of) throw new HttpFailure(400, "The comment this answers isn't there.")
        // Replies hang off the first comment, so a thread is one level deep
        parent = of.parent ?? of.id
      }
      const comment: ShareComment = { id: newId(9), anchor: body.anchor, ...(parent ? { parent } : {}), name: body.name, by: author ? "author" : "reader", text: body.text, at: now() }
      store.addComment(id, comment)
      send(id, "comments", { id: comment.id })
      return json(res, 201, comment)
    }

    if (sub === "comments" && commentId && method === "PATCH") {
      await requireAuthor(req, id)
      const resolved = checkResolve(await readBody(req, BODY_LIMITS.small))
      if (!store.comment(id, commentId)) throw new HttpFailure(404, "There is no such comment.")
      store.setResolved(id, commentId, resolved)
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
