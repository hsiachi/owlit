import { isOwlit, type ActorId, type ChangeAction, type CommentAnchor, type CommentInput, type DocComment } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { readJsonl, writeFileAtomic } from "../fs-util.ts"

// The comments on docs, kept beside the files and never in them: .owlit/docs/comments/ mirrors the
// workspace, so the comments on "writing/Related work.md" are in
// .owlit/docs/comments/writing/Related work.md.jsonl, one comment per line. A mirror (rather than hashed
// names) can be read by hand, and a folder's comments move with one rename. The caller (Docs) runs every
// call one at a time, alongside the file changes they follow.
export class Comments {
  private readonly dir: string
  private readonly trashDir: string
  // Comments moved to the trash by a delete, by the path deleted: where its mirror went
  private trashed = new Map<string, string>()

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "docs", "comments")
    this.trashDir = path.join(owlitDir, "trash")
  }

  // Every doc's comments, by path
  async all(): Promise<Record<string, DocComment[]>> {
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

  private fileOf(rel: string) {
    return path.join(this.dir, ...`${rel}.jsonl`.split("/"))
  }

  private mirrorOf(rel: string) {
    return path.join(this.dir, ...rel.split("/"))
  }

  // A comment an older owlit let the person dismiss (dismissedAt) reads as resolved: put away, and one
  // menu away in Resolved comments
  private async read(file: string): Promise<DocComment[]> {
    const comments = await readJsonl<DocComment & { dismissedAt?: number }>(file, () => console.error(`[core] skipping a comment that isn't JSON in ${file}`))
    return comments.map(({ dismissedAt, ...c }) => (dismissedAt === undefined ? c : { ...c, resolvedAt: c.resolvedAt ?? dismissedAt }))
  }

  private async save(rel: string, comments: DocComment[]) {
    const file = this.fileOf(rel)
    if (comments.length) await writeFileAtomic(file, comments.map((c) => JSON.stringify(c)).join("\n") + "\n")
    else await rm(file, { force: true })
  }
}

// A client's comment with each entry's author set by core: an entry the comment had keeps its own, a new
// one is by the caller
export function signed(comment: CommentInput, before: DocComment | null, by: ActorId): DocComment {
  return { ...comment, entries: comment.entries.map((e) => ({ ...e, by: before?.entries.find((b) => b.id === e.id)?.by ?? by })) }
}

// How a comment changed, as change log entries: made or removed whole (part: its id); each entry added,
// edited or removed (part: <comment>/<entry>); and its own fields (resolved, dismissed, folded, its
// anchor) as an update of the comment without its entries
export function commentChanges(before: DocComment | null, after: DocComment | null): { action: ChangeAction; part: string; before?: unknown; after?: unknown }[] {
  if (!before && !after) return []
  if (!before) return [{ action: "create", part: after!.id, after }]
  if (!after) return [{ action: "delete", part: before.id, before }]
  const out: { action: ChangeAction; part: string; before?: unknown; after?: unknown }[] = []
  const { entries: was, ...own } = before
  const { entries: now, ...next } = after
  if (JSON.stringify(own) !== JSON.stringify(next)) out.push({ action: "update", part: after.id, before: own, after: next })
  for (const e of now) {
    const old = was.find((w) => w.id === e.id)
    if (!old) out.push({ action: "create", part: `${after.id}/${e.id}`, after: e })
    else if (JSON.stringify(old) !== JSON.stringify(e)) out.push({ action: "update", part: `${after.id}/${e.id}`, before: old, after: e })
  }
  for (const e of was) if (!now.some((n) => n.id === e.id)) out.push({ action: "delete", part: `${after.id}/${e.id}`, before: e })
  return out
}

// ---- Owlit correcting its own comment ----

// What an Owlit reply under its own comment starts with when it rewrites the comment's first entry
// instead (recipes/reply.ts tells the agent; comments.put in core.ts applies it)
export const CORRECT = "CORRECT:"

// Owlit may rewrite its first entry: the comment is Owlit's and not a point a Go through carried over
// (source), whose first entry is what someone said
export const correctable = (comment: DocComment) => !!comment.entries[0] && isOwlit(comment.entries[0].by) && !comment.source

// The rewritten entry a reply gives, or null when it isn't a correction
export function correctionOf(text: string): string | null {
  const t = text.trim()
  return t.startsWith(CORRECT) ? t.slice(CORRECT.length).trim() || null : null
}

// The comment with its first entry rewritten: the old words kept as was and marked edited, which also
// makes the comment new to the person again (the doc's Owlit dot)
export function corrected(comment: DocComment, text: string, at: number): DocComment {
  const [first, ...rest] = comment.entries
  if (!first || first.text === text) return comment
  return { ...comment, entries: [{ ...first, text, was: first.was ?? first.text, editedAt: at }, ...rest] }
}
