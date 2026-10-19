import type { Change, ChangeFilter } from "@owlit/protocol"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { appendJsonl, writeFileAtomic } from "../fs-util.ts"
import { Serial } from "../util.ts"

// Older entries are dropped once a path has this many, or once they are this old
export const KEEP_PER_PATH = 200
export const KEEP_MS = 30 * 24 * 3_600_000
// Cleanup runs again after this many appends, besides on opening the workspace
const CLEANUP_EVERY = 100

export const changeId = (at: number, targetPath: string) => `${at}-${Math.random().toString(36).slice(2, 6)}-${targetPath.replace(/[/\\]/g, "__").slice(-80)}`

type Line = { text: string; change?: Change }

// .owlit/versions/: one line per change in index.jsonl, and beside it a file named by the entry's id
// holding a doc's text from before the change, when there was one
export class ChangeLog {
  private readonly dir: string
  private appended = 0
  // Appends and cleanup's rewrite take turns: a line appended while cleanup rewrites the file would be lost
  private readonly indexTurn = new Serial()

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "versions")
  }

  // content: the text from before, kept in its own file rather than inline
  async append(change: Change, content?: string) {
    await mkdir(this.dir, { recursive: true })
    if (content !== undefined) await writeFile(path.join(this.dir, change.id), content)
    await this.indexTurn.run(() => appendJsonl(path.join(this.dir, "index.jsonl"), change))
    if (++this.appended % CLEANUP_EVERY === 0) void this.cleanup().catch(() => undefined)
    return change
  }

  // Rewrites one entry in place (a typing session folding in another save): entries are append-only by
  // id, and this is the one change made to a line already written
  replace(change: Change) {
    return this.indexTurn.run(async () => {
      const lines = await this.lines()
      const at = lines.findLastIndex((l) => l.change?.id === change.id)
      if (at < 0) return
      lines[at] = { text: JSON.stringify(change), change }
      await this.rewrite(lines)
    })
  }

  async get(id: string): Promise<Change | null> {
    return (await this.index()).findLast((c) => c.id === id) ?? null
  }

  // The text from before that an entry kept, or null when it kept none
  content(id: string): Promise<string | null> {
    if (id.includes("/") || id.startsWith(".")) return Promise.resolve(null)
    return readFile(path.join(this.dir, id), "utf8").catch(() => null)
  }

  // Newest first
  async list(filter: ChangeFilter = {}) {
    const { target, path: at, chatId, actor, since } = filter
    return (await this.index())
      .filter(
        (c) =>
          (!target || ((target.kind === undefined || c.target.kind === target.kind) && (target.path === undefined || c.target.path === target.path) && (target.part === undefined || c.target.part === target.part))) &&
          (at === undefined || c.target.path === at) &&
          (chatId === undefined || c.origin.chatId === chatId) &&
          (actor === undefined || c.actor === actor) &&
          (since === undefined || c.at >= since),
      )
      .reverse()
  }

  // Drops what the keep rules say is no longer needed: beyond the newest KEEP_PER_PATH of a path, and
  // anything older than KEEP_MS. Lines the log doesn't read always stay (see lines())
  cleanup(now = Date.now()) {
    return this.indexTurn.run(async () => {
      const lines = await this.lines()
      const count = new Map<string, number>()
      const keep: Line[] = []
      const drop: Change[] = []
      for (const l of [...lines].reverse()) {
        const c = l.change
        if (!c) {
          keep.unshift(l)
          continue
        }
        const n = (count.get(c.target.path) ?? 0) + 1
        count.set(c.target.path, n)
        if (n > KEEP_PER_PATH || now - c.at > KEEP_MS) drop.push(c)
        else keep.unshift(l)
      }
      if (!drop.length) return 0
      await this.rewrite(keep)
      await Promise.all(drop.map((c) => rm(path.join(this.dir, c.id), { force: true })))
      return drop.length
    })
  }

  // Only lines in the log's own shape
  private async index() {
    return (await this.lines()).flatMap((l) => (l.change ? [l.change] : []))
  }

  // Every line of the file, with the entry when it is one in the log's own shape. An owlit built before the
  // change log, opening the same workspace, writes its version records into this file too (a line without a
  // target), and a line can be one this build can't parse: the log never reads those, and
  // replace() and cleanup() write them back as they were, where they were, so that owlit keeps its history
  private async lines(): Promise<Line[]> {
    const text = await readFile(path.join(this.dir, "index.jsonl"), "utf8").catch(() => "")
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          const value = JSON.parse(line) as Change | null
          return { text: line, change: value && typeof value === "object" && value.target ? value : undefined }
        } catch {
          return { text: line }
        }
      })
  }

  private rewrite(lines: Line[]) {
    return writeFileAtomic(path.join(this.dir, "index.jsonl"), lines.map((l) => l.text + "\n").join(""))
  }
}
