import { isWithin, type DocOwlit } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"

interface OwlitFile {
  version: 1
  docs: Record<string, DocOwlit>
}

// .owlit/docs/owlit.json: what owlit keeps about Owlit and each of your docs (kept out or not), by path.
// Docs moves an entry with its doc and drops it with a deleted one. Keys an older build wrote for a doc
// (its last look, what it went through) are dropped when the file is read, and so from the file the
// next time it is written.
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
      const docs = Object.entries(stored?.docs ?? {}).flatMap(([rel, entry]) => (entry.out ? [[rel, { out: entry.out }] as const] : []))
      this.stored = { version: 1, docs: Object.fromEntries(docs) }
    }
    return this.stored
  }
}
