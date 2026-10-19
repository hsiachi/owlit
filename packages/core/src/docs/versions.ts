import type { DocComment, MemoryLine } from "@owlit/protocol"
import { createHash } from "node:crypto"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { appendJsonl, readJsonl, writeFileAtomic } from "../fs-util.ts"
import { Serial } from "../util.ts"

// One snapshot: something as it was before an agent (or an undo) changed it, so the change can be
// taken back. Every kind of agent write goes through here, so they share one way to undo:
//   file    a doc's text before the write
//   note    a comment left on a doc (added, or removed by an undo), with the comment itself (versions
//           kept before comments hold an agent's note, read as a comment)
//   paper   a paper added to the library (or removed by an undo)
//   thread  a thread's thread.json before an agent wrote to it (path is the thread's id)
//   memory  one line of Owlit's memory before an agent changed it (path is the line's id; null: it was new)
export type VersionKind = "file" | "note" | "paper" | "thread" | "memory"

export interface Version {
  id: string
  kind: VersionKind
  // file: workspace-relative path; note: the doc's path; paper: the paper's id
  path: string
  at: number
  chatId?: string
  // agent: a change an agent made; undo: the state an undo replaced, so the undo can be undone; outside:
  // another program's text the user wrote over with theirs (Keep mine)
  by: "agent" | "undo" | "outside"
  // file and thread: whether it existed before; restoring a version of one that didn't removes it
  existed?: boolean
  // file and memory: sha1 of what was written, so a restore can tell whether anyone changed it since
  after?: string
  // file: the write deleted it; restoring writes it back
  deleted?: true
  // note and paper: what the change did
  op?: "added" | "removed"
  noteId?: string
}

// Older versions are dropped once a file has this many, or once they are this old
export const KEEP_PER_PATH = 50
export const KEEP_MS = 30 * 24 * 3_600_000

export const sha1 = (text: string) => createHash("sha1").update(text).digest("hex")

// .owlit/versions/: each version's content in <id> (a file's text, a comment's JSON), and a line
// describing it in index.jsonl
export class Versions {
  private readonly dir: string
  private saved = 0
  // index.jsonl's appends and cleanup's rewrite take turns: a line appended while cleanup rewrites the
  // file would be lost
  private readonly indexTurn = new Serial()

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "versions")
  }

  // after is null when the write deleted the file
  saveFile(rel: string, before: string | null, after: string | null, meta: { chatId?: string; by?: Version["by"] } = {}) {
    return this.save(
      {
        kind: "file",
        path: rel,
        existed: before !== null,
        after: sha1(after ?? ""),
        ...(after === null ? { deleted: true as const } : {}),
      },
      before ?? "",
      meta,
    )
  }

  saveComment(docPath: string, comment: DocComment, op: "added" | "removed", meta: { chatId?: string; by?: Version["by"] } = {}) {
    return this.save({ kind: "note", path: docPath, op, noteId: comment.id }, JSON.stringify(comment), meta)
  }

  savePaper(id: string, op: "added" | "removed", meta: { chatId?: string; by?: Version["by"] } = {}) {
    return this.save({ kind: "paper", path: id, op }, "", meta)
  }

  // before is null when the change added the line, after when it removed it
  saveMemory(id: string, before: MemoryLine | null, after: string | null, meta: { chatId?: string; by?: Version["by"] } = {}) {
    return this.save({ kind: "memory", path: id, existed: before !== null, after: sha1(after ?? "") }, JSON.stringify({ before }), meta)
  }

  // before is null when the write started the thread
  saveThread(id: string, before: string | null, meta: { chatId?: string; by?: Version["by"] } = {}) {
    return this.save({ kind: "thread", path: id, existed: before !== null }, before ?? "", meta)
  }

  // The version and what it kept, or null when it isn't there
  async get(id: string): Promise<(Version & { content: string }) | null> {
    if (id.includes("/") || id.startsWith(".")) return null
    const version = (await this.index()).findLast((v) => v.id === id)
    if (!version) return null
    const content = await readFile(path.join(this.dir, id), "utf8").catch(() => null)
    return content === null ? null : { ...version, content }
  }

  // Newest first
  async list(filter: { path?: string; since?: number } = {}) {
    return (await this.index())
      .filter((v) => (filter.path === undefined || v.path === filter.path) && (filter.since === undefined || v.at >= filter.since))
      .reverse()
  }

  // Drops what the keep rules say is no longer needed: beyond the newest KEEP_PER_PATH of a path, and
  // anything older than KEEP_MS
  cleanup(now = Date.now()) {
    return this.indexTurn.run(() => this.dropOld(now))
  }

  private async dropOld(now: number) {
    const all = await this.index()
    const count = new Map<string, number>()
    const keep: Version[] = []
    const drop: Version[] = []
    for (const v of [...all].reverse()) {
      const n = (count.get(v.path) ?? 0) + 1
      count.set(v.path, n)
      if (n > KEEP_PER_PATH || now - v.at > KEEP_MS) drop.push(v)
      else keep.unshift(v)
    }
    if (!drop.length) return 0
    await writeFileAtomic(path.join(this.dir, "index.jsonl"), keep.map((v) => JSON.stringify(v) + "\n").join(""))
    await Promise.all(drop.map((v) => rm(path.join(this.dir, v.id), { force: true })))
    return drop.length
  }

  private async save(fields: Omit<Version, "id" | "at" | "by" | "chatId">, content: string, meta: { chatId?: string; by?: Version["by"] }) {
    const at = Date.now()
    const id = `${at}-${Math.random().toString(36).slice(2, 6)}-${fields.path.replace(/[/\\]/g, "__").slice(-80)}`
    const version: Version = { id, at, by: meta.by ?? "agent", ...(meta.chatId ? { chatId: meta.chatId } : {}), ...fields }
    await mkdir(this.dir, { recursive: true })
    await writeFile(path.join(this.dir, id), content)
    await this.indexTurn.run(() => appendJsonl(path.join(this.dir, "index.jsonl"), version))
    if (++this.saved % 100 === 0) void this.cleanup().catch(() => undefined)
    return version
  }

  // Lines written before versions had kinds are file versions
  private async index(): Promise<Version[]> {
    const lines = await readJsonl<Version>(path.join(this.dir, "index.jsonl"))
    return lines.map((v) => ({ ...v, kind: v.kind ?? "file", by: v.by ?? "agent" }))
  }
}
