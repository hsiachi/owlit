import { DurableObject } from "cloudflare:workers"
import type { ShareBundle, ShareComment, SharePermission, ShareView } from "@owlit/protocol"
import { BODY_LIMITS, carriesKey, checkChange, checkComment, checkResolve, COMMENTS_PER_SHARE, HttpFailure, newId, RATES, underRate } from "@owlit/share-server/rules"
import { json, readJson } from "./http.ts"

// One shared doc: its bundle as the author last pushed it, its comments, and the sockets of the readers who
// have it open. Everything about a share is answered here, one request at a time, so nothing interleaves.
// Readers' sockets hibernate: an open page costs nothing until something changes.

// A bundle is kept in parts, since a row holds at most 2 MB and a part of this many characters stays under it
// even in four-byte characters
const PART = 400_000

interface CommentRow {
  id: string
  parent: string | null
  anchor: string | null
  name: string
  by: "reader" | "author"
  text: string
  at: number
  resolved: number
}

export class ShareRoom extends DurableObject<Env> {
  private sql: SqlStorage
  // Comments per address, for as long as this object stays in memory
  private hits = new Map<string, number[]>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS bundle (i INTEGER PRIMARY KEY, part TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, parent TEXT, anchor TEXT, name TEXT NOT NULL, by TEXT NOT NULL,
        text TEXT NOT NULL, at INTEGER NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
      );
    `)
    // A page keeps its socket alive with "ping"; answered without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
  }

  // Called once, by the worker, as the share is made
  async create(share: { id: string; tokenHash: string; bundle: ShareBundle; permission: SharePermission; now: number }) {
    if (this.get("id")) throw new Error("This share exists already.")
    this.ctx.storage.transactionSync(() => {
      this.set("id", share.id)
      this.set("tokenHash", share.tokenHash)
      this.set("permission", share.permission)
      this.set("createdAt", String(share.now))
      this.set("updatedAt", String(share.now))
      this.writeBundle(share.bundle)
    })
  }

  async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request)
    } catch (error) {
      if (error instanceof HttpFailure) return json(error.status, { error: error.message })
      console.error("[share] request failed", error)
      return json(500, { error: "Something went wrong on the server." })
    }
  }

  private async route(request: Request): Promise<Response> {
    const id = this.get("id")
    if (!id) throw new HttpFailure(404, "There is no share at this link.")
    const [, , , , sub, commentId] = new URL(request.url).pathname.split("/")
    const stopped = !!this.get("stoppedAt")
    const author = () => carriesKey(request.headers.get("authorization"), this.get("tokenHash")!)
    const requireAuthor = async () => {
      if (!(await author())) throw new HttpFailure(403, "Only the author can change this share.")
    }
    const gone = () => json(410, { error: "The author stopped sharing this.", stopped: true })
    const method = request.method

    if (!sub) {
      if (method === "GET") {
        if (stopped) return gone()
        const view: ShareView = { id, bundle: this.readBundle(), permission: this.permission(), updatedAt: Number(this.get("updatedAt")), live: "socket" }
        return json(200, view)
      }
      if (method === "PUT") {
        await requireAuthor()
        if (stopped) throw new HttpFailure(410, "This share was stopped.")
        const change = checkChange(await readJson(request, BODY_LIMITS.share))
        const now = Date.now()
        this.ctx.storage.transactionSync(() => {
          if (change.bundle) this.writeBundle(change.bundle)
          if (change.permission) this.set("permission", change.permission)
          this.set("updatedAt", String(now))
        })
        this.tell({ type: "update", updatedAt: now })
        return json(200, { updatedAt: now })
      }
      if (method === "DELETE") {
        await requireAuthor()
        if (!stopped) {
          // The bundle goes; the comments stay, for the author
          this.ctx.storage.transactionSync(() => {
            this.sql.exec("DELETE FROM bundle")
            this.set("stoppedAt", String(Date.now()))
          })
          this.tell({ type: "stopped" })
          for (const ws of this.ctx.getWebSockets()) ws.close(1000, "stopped")
        }
        return new Response(null, { status: 204 })
      }
      throw new HttpFailure(405, "Method not allowed.")
    }

    if (sub === "socket" && method === "GET") {
      if (stopped) return gone()
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new HttpFailure(426, "This takes a WebSocket.")
      const { 0: client, 1: server } = new WebSocketPair()
      this.ctx.acceptWebSocket(server)
      return new Response(null, { status: 101, webSocket: client })
    }

    if (sub === "comments" && !commentId) {
      const isAuthor = await author()
      if (stopped && !isAuthor) return gone()
      if (method === "GET") return json(200, this.comments())
      if (method !== "POST") throw new HttpFailure(405, "Method not allowed.")
      if (stopped) throw new HttpFailure(410, "This share was stopped.")
      if (!isAuthor && this.permission() !== "comment") throw new HttpFailure(403, "This share can be read but not commented on.")
      if (!isAuthor && !underRate(this.hits, request.headers.get("cf-connecting-ip") ?? "?", RATES.comment, Date.now())) {
        throw new HttpFailure(429, "Too many requests from here; try again a little later.")
      }
      const count = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM comments").one().n
      if (count >= COMMENTS_PER_SHARE) throw new HttpFailure(429, "This share has as many comments as it can hold.")
      const body = checkComment(await readJson(request, BODY_LIMITS.comment))
      let parent: string | undefined
      if (body.parent) {
        const of = this.sql.exec<{ id: string; parent: string | null }>("SELECT id, parent FROM comments WHERE id = ?", body.parent).toArray()[0]
        if (!of) throw new HttpFailure(400, "The comment this answers isn't there.")
        // Replies hang off the first comment, so a thread is one level deep
        parent = of.parent ?? of.id
      }
      const comment: ShareComment = { id: newId(9), anchor: body.anchor, ...(parent ? { parent } : {}), name: body.name, by: isAuthor ? "author" : "reader", text: body.text, at: Date.now() }
      this.sql.exec(
        "INSERT INTO comments (id, parent, anchor, name, by, text, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        comment.id,
        comment.parent ?? null,
        comment.anchor ? JSON.stringify(comment.anchor) : null,
        comment.name,
        comment.by,
        comment.text,
        comment.at,
      )
      this.tell({ type: "comments", id: comment.id })
      return json(201, comment)
    }

    if (sub === "comments" && commentId && method === "PATCH") {
      await requireAuthor()
      const resolved = checkResolve(await readJson(request, BODY_LIMITS.small))
      const changed = this.sql.exec("UPDATE comments SET resolved = ? WHERE id = ?", resolved ? 1 : 0, commentId).rowsWritten
      if (!changed) throw new HttpFailure(404, "There is no such comment.")
      this.tell({ type: "comments", id: commentId })
      return new Response(null, { status: 204 })
    }

    throw new HttpFailure(404, "Not found.")
  }

  // A page that closes its socket gets the close answered
  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code === 1005 ? 1000 : code, reason)
    } catch {
      // Closed already
    }
  }

  private tell(message: { type: "update"; updatedAt: number } | { type: "comments"; id: string } | { type: "stopped" }) {
    const text = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text)
      } catch {
        // A socket going away as it is told
      }
    }
  }

  private comments(): ShareComment[] {
    return this.sql
      .exec<Record<string, SqlStorageValue>>("SELECT * FROM comments ORDER BY at, id")
      .toArray()
      .map((row) => {
        const r = row as unknown as CommentRow
        return {
          id: r.id,
          anchor: r.anchor ? JSON.parse(r.anchor) : null,
          ...(r.parent ? { parent: r.parent } : {}),
          name: r.name,
          by: r.by,
          text: r.text,
          at: r.at,
          ...(r.resolved ? { resolved: true } : {}),
        }
      })
  }

  private permission(): SharePermission {
    return this.get("permission") === "view" ? "view" : "comment"
  }

  private writeBundle(bundle: ShareBundle) {
    const text = JSON.stringify(bundle)
    this.sql.exec("DELETE FROM bundle")
    // A part never ends between the two halves of a four-byte character: stored alone, each half would turn
    // into U+FFFD
    for (let i = 0, at = 0; at < text.length; i++) {
      let end = Math.min(at + PART, text.length)
      const last = text.charCodeAt(end - 1)
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--
      this.sql.exec("INSERT INTO bundle (i, part) VALUES (?, ?)", i, text.slice(at, end))
      at = end
    }
  }

  private readBundle(): ShareBundle {
    const parts = this.sql.exec<{ part: string }>("SELECT part FROM bundle ORDER BY i").toArray()
    return JSON.parse(parts.map((p) => p.part).join("")) as ShareBundle
  }

  private get(key: string): string | undefined {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value
  }

  private set(key: string, value: string) {
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value)
  }
}
