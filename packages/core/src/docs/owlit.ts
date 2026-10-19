import { isWithin, type DocOwlit } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"

interface OwlitFile {
  version: 1
  docs: Record<string, DocOwlit>
}

// .owlit/docs/owlit.json: what owlit keeps about Owlit and each of your docs (kept out or not, what it
// went through), by path. Docs moves an entry with its doc and drops it with a deleted one. Keys an
// older build wrote for a doc (its last look) are dropped as the entry is next written.
export class DocsOwlit {
  private readonly file: string
  private stored: OwlitFile | undefined

  constructor(owlitDir: string) {
    this.file = path.join(owlitDir, "docs", "owlit.json")
  }

  async get(rel: string): Promise<DocOwlit> {
    return (await this.load()).docs[rel] ?? {}
  }

  setOut(rel: string, out: boolean) {
    return this.change(rel, (entry) => {
      const { out: _was, ...rest } = entry
      return out ? { ...rest, out: entry.out ?? Date.now() } : rest
    })
  }

  setWentThrough(rel: string, wentThrough: { at: number; record: string }) {
    return this.change(rel, (entry) => ({ ...entry, wentThrough }))
  }

  // A doc or folder moved: the entries under it follow
  async move(from: string, to: string) {
    await this.rewrite((docs) => Object.fromEntries(Object.entries(docs).map(([p, e]) => [isWithin(p, from) ? to + p.slice(from.length) : p, e])))
  }

  // A doc or folder is gone
  async drop(rel: string) {
    await this.rewrite((docs) => Object.fromEntries(Object.entries(docs).filter(([p]) => !isWithin(p, rel))))
  }

  private async change(rel: string, edit: (entry: DocOwlit) => DocOwlit) {
    let next: DocOwlit = {}
    await this.rewrite((docs) => {
      next = edit(docs[rel] ?? {})
      const { [rel]: _old, ...rest } = docs
      return Object.keys(next).length ? { ...rest, [rel]: next } : rest
    })
    return next
  }

  private async rewrite(change: (docs: Record<string, DocOwlit>) => Record<string, DocOwlit>) {
    const stored = await this.load()
    const docs = change(stored.docs)
    if (JSON.stringify(docs) === JSON.stringify(stored.docs)) return
    this.stored = { ...stored, docs }
    await writeJsonAtomic(this.file, this.stored)
  }

  private async load() {
    if (!this.stored) {
      const stored = await readJson<OwlitFile>(this.file).catch(() => undefined)
      this.stored = { version: 1, docs: stored?.docs ?? {} }
    }
    return this.stored
  }
}
