import { isWithin, type DocLook, type DocOwlit } from "@owlit/protocol"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"

interface OwlitFile {
  version: 1
  docs: Record<string, DocOwlit>
  // When Owlit last looked over all the docs (its daily look while the user is away)
  scannedAt?: number
}

// .owlit/docs/owlit.json: what owlit keeps about Owlit and each of your docs (kept out or not, its last
// look), by path, and when it last looked over them all. Docs moves an entry with its doc and drops it with a deleted one.
export class DocsOwlit {
  private readonly file: string
  private stored: OwlitFile | undefined

  constructor(owlitDir: string) {
    this.file = path.join(owlitDir, "docs", "owlit.json")
  }

  async get(rel: string): Promise<DocOwlit> {
    return (await this.load()).docs[rel] ?? {}
  }

  async scannedAt(): Promise<number | null> {
    return (await this.load()).scannedAt ?? null
  }

  async setScannedAt(at: number) {
    const stored = await this.load()
    this.stored = { ...stored, scannedAt: at }
    await writeJsonAtomic(this.file, this.stored)
  }

  setOut(rel: string, out: boolean) {
    return this.change(rel, (entry) => {
      const { out: _was, ...rest } = entry
      return out ? { ...rest, out: entry.out ?? Date.now() } : rest
    })
  }

  setLooked(rel: string, looked: DocLook) {
    return this.change(rel, (entry) => ({ ...entry, looked }))
  }

  setHalfDone(rel: string, halfDone: Record<string, number>) {
    return this.change(rel, (entry) => {
      const { halfDone: _was, ...rest } = entry
      return Object.keys(halfDone).length ? { ...rest, halfDone } : rest
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
      this.stored = { version: 1, docs: stored?.docs ?? {}, ...(stored?.scannedAt ? { scannedAt: stored.scannedAt } : {}) }
    }
    return this.stored
  }
}
