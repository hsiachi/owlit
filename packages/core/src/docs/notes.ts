import type { AgentNote } from "@owlit/protocol"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises"
import path from "node:path"
import { writeFileAtomic } from "../fs-util.ts"

// The notes agents leave on docs, kept beside the files and never in them: .owlit/docs/notes/ mirrors
// the workspace, so the notes of "writing/Related work.md" are in
// .owlit/docs/notes/writing/Related work.md.jsonl, one note per line. A mirror (rather than hashed
// names) can be read by hand, and a folder's notes move with one rename. The caller (Docs) runs every
// call one at a time, alongside the file changes they follow.
export class Notes {
  private readonly dir: string
  private readonly trashDir: string
  // Notes moved to the trash by a delete, by the path deleted: where its mirror went
  private trashed = new Map<string, string>()

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "docs", "notes")
    this.trashDir = path.join(owlitDir, "trash")
  }

  // Every doc's notes, by path
  async all(): Promise<Record<string, AgentNote[]>> {
    const found: Record<string, AgentNote[]> = {}
    const entries = await readdir(this.dir, { recursive: true, withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      const file = path.join(entry.parentPath, entry.name)
      const rel = path.relative(this.dir, file).split(path.sep).join("/").slice(0, -".jsonl".length)
      const notes = await this.read(file)
      if (notes.length) found[rel] = notes
    }
    return found
  }

  list(rel: string) {
    return this.read(this.fileOf(rel))
  }

  // Adds a note, or puts one back (Undo of a dismissal); notes stay in the order they were written
  async add(rel: string, note: AgentNote) {
    const notes = (await this.list(rel)).filter((n) => n.id !== note.id)
    await this.save(rel, [...notes, note].sort((a, b) => a.createdAt - b.createdAt))
  }

  // The note removed, or null if it wasn't there
  async remove(rel: string, id: string) {
    const notes = await this.list(rel)
    const note = notes.find((n) => n.id === id) ?? null
    if (note) await this.save(rel, notes.filter((n) => n.id !== id))
    return note
  }

  // Passages edited while the doc was open: each note keeps finding its words as they read now
  async reanchor(rel: string, moved: Record<string, Pick<AgentNote, "quote" | "prefix" | "suffix">>) {
    const notes = await this.list(rel)
    if (!notes.some((n) => moved[n.id])) return
    await this.save(rel, notes.map((n) => (moved[n.id] ? { ...n, ...moved[n.id] } : n)))
  }

  // A file or folder was renamed or moved: its notes follow
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

  // A file or folder was deleted in owlit: its notes go to .owlit/trash/, where Undo finds them
  async trash(rel: string) {
    const holder = path.join(this.trashDir, `${Date.now()}-notes`)
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

  // A deleted doc came back (at `at`, which may differ from where it was): so do its notes
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

  private async read(file: string): Promise<AgentNote[]> {
    const text = await readFile(file, "utf8").catch(() => "")
    const notes: AgentNote[] = []
    for (const line of text.split("\n")) {
      if (!line.trim()) continue
      try {
        notes.push(JSON.parse(line) as AgentNote)
      } catch {
        // A line broken by hand is skipped, not fatal for the others
        console.error(`[core] skipping a note that isn't JSON in ${file}`)
      }
    }
    return notes
  }

  private async save(rel: string, notes: AgentNote[]) {
    const file = this.fileOf(rel)
    if (notes.length) await writeFileAtomic(file, notes.map((n) => JSON.stringify(n)).join("\n") + "\n")
    else await rm(file, { force: true })
  }
}
