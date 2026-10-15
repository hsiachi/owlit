import { asComment, type CommentAnchor, type DocComment } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { readJsonl, writeFileAtomic } from "../fs-util.ts"

// The comments on docs, kept beside the files and never in them: .owlit/docs/comments/ mirrors the
// workspace, so the comments on "writing/Related work.md" are in
// .owlit/docs/comments/writing/Related work.md.jsonl, one comment per line. A mirror (rather than hashed
// names) can be read by hand, and a folder's comments move with one rename. Before comments, agents left
// notes in .owlit/docs/notes/ with one text each; that folder is renamed on first use and its lines read
// as Owlit's comments. The caller (Docs) runs every call one at a time, alongside the file changes they
// follow.
export class Comments {
  private readonly dir: string
  private readonly legacyDir: string
  private readonly trashDir: string
  // Comments moved to the trash by a delete, by the path deleted: where its mirror went
  private trashed = new Map<string, string>()
  private migrated = false

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "docs", "comments")
    this.legacyDir = path.join(owlitDir, "docs", "notes")
    this.trashDir = path.join(owlitDir, "trash")
  }

  // Every doc's comments, by path
  async all(): Promise<Record<string, DocComment[]>> {
    await this.migrate()
    const found: Record<string, DocComment[]> = {}
    const entries = await readdir(this.dir, { recursive: true, withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      const file = path.join(entry.parentPath, entry.name)
      const rel = path.relative(this.dir, file).split(path.sep).join("/").slice(0, -".jsonl".length)
      const comments = await this.read(file)
      if (comments.length) found[rel] = comments
    }
    return found
  }

  async list(rel: string) {
    await this.migrate()
    return this.read(this.fileOf(rel))
  }

  // Starts a comment, or puts one back (Undo of a delete); comments stay in the order they were started
  async add(rel: string, comment: DocComment) {
    const comments = (await this.list(rel)).filter((c) => c.id !== comment.id)
    await this.save(rel, [...comments, comment].sort((a, b) => a.createdAt - b.createdAt))
  }

  // Replaces a comment with how it reads now; the comment as it was, or null (then it is added)
  async put(rel: string, comment: DocComment) {
    const comments = await this.list(rel)
    const before = comments.find((c) => c.id === comment.id) ?? null
    if (!before) await this.add(rel, comment)
    else await this.save(rel, comments.map((c) => (c.id === comment.id ? comment : c)))
    return before
  }

  // The comment removed, or null if it wasn't there
  async remove(rel: string, id: string) {
    const comments = await this.list(rel)
    const comment = comments.find((c) => c.id === id) ?? null
    if (comment) await this.save(rel, comments.filter((c) => c.id !== id))
    return comment
  }

  // Passages edited while the doc was open: each comment keeps finding its words as they read now
  async reanchor(rel: string, moved: Record<string, CommentAnchor>) {
    const comments = await this.list(rel)
    if (!comments.some((c) => moved[c.id])) return
    await this.save(rel, comments.map((c) => (moved[c.id] ? { ...c, ...moved[c.id] } : c)))
  }

  // A file or folder was renamed or moved: its comments follow
  async move(from: string, to: string) {
    await this.migrate()
    for (const [src, dest] of [
      [this.fileOf(from), this.fileOf(to)],
      [this.mirrorOf(from), this.mirrorOf(to)],
    ]) {
      if (!existsSync(src)) continue
      await mkdir(path.dirname(dest), { recursive: true })
      await rename(src, dest)
    }
  }

  // A file or folder was deleted in owlit: its comments go to .owlit/trash/, where Undo finds them
  async trash(rel: string) {
    await this.migrate()
    const holder = path.join(this.trashDir, `${Date.now()}-comments`)
    let moved = false
    for (const [src, dest] of [
      [this.fileOf(rel), path.join(holder, `${rel}.jsonl`)],
      [this.mirrorOf(rel), path.join(holder, rel)],
    ]) {
      if (!existsSync(src)) continue
      await mkdir(path.dirname(dest), { recursive: true })
      await rename(src, dest)
      moved = true
    }
    if (moved) this.trashed.set(rel, holder)
  }

  // A deleted doc came back (at `at`, which may differ from where it was): so do its comments
  async untrash(original: string, at: string) {
    for (const [deleted, holder] of this.trashed) {
      if (original !== deleted && !original.startsWith(deleted + "/")) continue
      const src = path.join(holder, `${original}.jsonl`)
      if (!existsSync(src)) continue
      await mkdir(path.dirname(this.fileOf(at)), { recursive: true })
      await rename(src, this.fileOf(at))
      return
    }
  }

  // The notes folder from before comments becomes the comments folder; its lines are converted as read
  private async migrate() {
    if (this.migrated) return
    this.migrated = true
    if (existsSync(this.legacyDir) && !existsSync(this.dir)) await rename(this.legacyDir, this.dir).catch(() => undefined)
  }

  private fileOf(rel: string) {
    return path.join(this.dir, ...`${rel}.jsonl`.split("/"))
  }

  private mirrorOf(rel: string) {
    return path.join(this.dir, ...rel.split("/"))
  }

  private async read(file: string): Promise<DocComment[]> {
    const lines = await readJsonl<Parameters<typeof asComment>[0]>(file, () => console.error(`[core] skipping a comment that isn't JSON in ${file}`))
    return lines.map(asComment)
  }

  private async save(rel: string, comments: DocComment[]) {
    const file = this.fileOf(rel)
    if (comments.length) await writeFileAtomic(file, comments.map((c) => JSON.stringify(c)).join("\n") + "\n")
    else await rm(file, { force: true })
  }
}
