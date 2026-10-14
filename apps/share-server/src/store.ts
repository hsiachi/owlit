import type { ShareAnchor, ShareComment, SharePermission } from "@owlit/protocol"
import { DatabaseSync } from "node:sqlite"

export interface ShareRow {
  id: string
  tokenHash: string
  // The bundle as JSON; "" once the share stopped
  bundle: string
  permission: SharePermission
  createdAt: number
  updatedAt: number
  stoppedAt: number | null
}

interface CommentRow {
  id: string
  share_id: string
  parent: string | null
  anchor: string | null
  name: string
  by: "reader" | "author"
  text: string
  at: number
  resolved: number
}

// Everything the server keeps, in one SQLite file: the shares (the bundle as the author last pushed it)
// and their comments. A stopped share keeps its row, without its bundle, so its link says it stopped
// rather than that it never was.
export class Store {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        bundle TEXT NOT NULL,
        permission TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        stopped_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL REFERENCES shares(id),
        parent TEXT,
        anchor TEXT,
        name TEXT NOT NULL,
        by TEXT NOT NULL,
        text TEXT NOT NULL,
        at INTEGER NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS comments_by_share ON comments (share_id, at);
    `)
  }

  createShare(row: Omit<ShareRow, "stoppedAt">) {
    this.db
      .prepare("INSERT INTO shares (id, token_hash, bundle, permission, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.tokenHash, row.bundle, row.permission, row.createdAt, row.updatedAt)
  }

  share(id: string): ShareRow | undefined {
    const row = this.db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      id: row.id as string,
      tokenHash: row.token_hash as string,
      bundle: row.bundle as string,
      permission: row.permission as SharePermission,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      stoppedAt: (row.stopped_at as number | null) ?? null,
    }
  }

  updateShare(id: string, change: { bundle?: string; permission?: SharePermission }, now: number) {
    if (change.bundle !== undefined) this.db.prepare("UPDATE shares SET bundle = ?, updated_at = ? WHERE id = ?").run(change.bundle, now, id)
    if (change.permission !== undefined) this.db.prepare("UPDATE shares SET permission = ?, updated_at = ? WHERE id = ?").run(change.permission, now, id)
  }

  stopShare(id: string, now: number) {
    this.db.prepare("UPDATE shares SET bundle = '', stopped_at = ?, updated_at = ? WHERE id = ?").run(now, now, id)
  }

  comments(shareId: string): ShareComment[] {
    // Comments posted in the same millisecond keep the order they came in: rowid counts inserts, ids are random
    const rows = this.db.prepare("SELECT * FROM comments WHERE share_id = ? ORDER BY at, rowid").all(shareId) as unknown as CommentRow[]
    return rows.map((r) => ({
      id: r.id,
      anchor: r.anchor ? (JSON.parse(r.anchor) as ShareAnchor) : null,
      ...(r.parent ? { parent: r.parent } : {}),
      name: r.name,
      by: r.by,
      text: r.text,
      at: r.at,
      ...(r.resolved ? { resolved: true } : {}),
    }))
  }

  comment(shareId: string, id: string) {
    return this.db.prepare("SELECT id, parent FROM comments WHERE share_id = ? AND id = ?").get(shareId, id) as { id: string; parent: string | null } | undefined
  }

  countComments(shareId: string) {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE share_id = ?").get(shareId) as { n: number }).n
  }

  addComment(shareId: string, comment: ShareComment) {
    this.db
      .prepare("INSERT INTO comments (id, share_id, parent, anchor, name, by, text, at, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)")
      .run(comment.id, shareId, comment.parent ?? null, comment.anchor ? JSON.stringify(comment.anchor) : null, comment.name, comment.by, comment.text, comment.at)
  }

  setResolved(shareId: string, id: string, resolved: boolean) {
    this.db.prepare("UPDATE comments SET resolved = ? WHERE share_id = ? AND id = ?").run(resolved ? 1 : 0, shareId, id)
  }

  close() {
    this.db.close()
  }
}
