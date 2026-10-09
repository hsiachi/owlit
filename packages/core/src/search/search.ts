import type { Chat, PaletteResults, SearchHit, SearchStatus, LinkSource } from "@owlit/protocol"
import { rmSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import type { Library } from "../library/library.ts"
import { isPaperId, PAPERS_DIR, paperDir, paperStateDir } from "../library/paths.ts"
import { defineTask, type TaskContext, type TaskDefinition } from "../tasks/index.ts"
import { OWLIT_DIR } from "../workspace/paths.ts"
import { IndexDb, linksIn, type Source } from "./index-db.ts"

// The workspace's search index: what is in it, kept in step with the files by index.sync, which reads
// only what changed since it last looked (by modification times). Core asks for a sync after anything
// it writes and after the watchers hear of outside changes; a sync waits for things to settle first.

const SETTLE_MS = 1500

export class SearchIndex {
  private readonly root: string
  private readonly dataDir: string
  private readonly library: Library
  private db: IndexDb
  private indexing = false
  private requestSync: () => void = () => {}

  constructor(root: string, dataDir: string, library: Library) {
    this.root = root
    this.dataDir = dataDir
    this.library = library
    this.db = new IndexDb(dataDir)
    this.indexing = this.db.empty
  }

  // How to ask for a sync (the scheduler's debounce), and the first one
  attach(request: () => void) {
    this.requestSync = request
    request()
  }

  // Something in the workspace changed: look again once things settle
  touch() {
    this.requestSync()
  }

  status(): SearchStatus {
    return {
      state: this.indexing ? "indexing" : "ready",
      papers: this.db.signatures("paper").size,
      docs: this.db.signatures("doc").size,
      chats: this.db.signatures("chat").size,
    }
  }

  palette(query: string): PaletteResults & { indexing: boolean } {
    return { ...this.db.palette(query), indexing: this.indexing }
  }

  papers(query: string, marked = false): SearchHit[] {
    return this.db.papers(query, 200, marked)
  }

  // What mentions a paper or doc (under any id it has had)
  async linksTo(uri: string): Promise<LinkSource[]> {
    const uris = [uri]
    const id = uri.match(/^owlit:\/\/library\/(.+)$/)?.[1]
    if (id) for (const [from, to] of Object.entries(await this.library.aliases())) if (to === id) uris.push(`owlit://library/${from}`)
    return this.db.linksTo(uris)
  }

  // Deletes the index and reads everything again
  rebuild() {
    this.db.close()
    for (const suffix of ["", "-wal", "-shm"]) rmSync(this.db.file + suffix, { force: true })
    this.db = new IndexDb(this.dataDir)
    this.indexing = true
    this.requestSync()
  }

  dispose() {
    this.db.close()
  }

  tasks(): TaskDefinition[] {
    return [
      defineTask("index.sync", { lane: "index", retries: 1, run: (ctx) => this.sync(ctx) }),
      // A paper's metadata, text, tags or note changed
      defineTask("index.paper", {
        lane: "index",
        run: async (ctx) => {
          await this.indexPaper(ctx.task.subject, await this.paperSignature(ctx.task.subject))
        },
      }),
    ]
  }

  // ---- Reading the workspace

  private async sync(ctx: TaskContext) {
    const docs = await this.docFiles()
    const papers = await this.paperIds()
    const chats = await this.chatIds()
    const todo: [Source, string, string][] = []
    const seen: Record<Source, Map<string, string>> = { doc: new Map(), paper: new Map(), chat: new Map() }
    for (const [rel, sig] of docs) seen.doc.set(rel, sig)
    for (const id of papers) seen.paper.set(id, await this.paperSignature(id))
    for (const [id, sig] of chats) seen.chat.set(id, sig)
    for (const source of ["paper", "doc", "chat"] as const) {
      const known = this.db.signatures(source)
      for (const [key, sig] of seen[source]) if (known.get(key) !== sig) todo.push([source, key, sig])
      for (const key of known.keys()) if (!seen[source].has(key)) this.db.remove(source, key)
    }
    for (const [i, [source, key, sig]] of todo.entries()) {
      ctx.signal.throwIfAborted()
      ctx.progress(i, todo.length, source)
      if (source === "paper") await this.indexPaper(key, sig)
      else if (source === "doc") await this.indexDoc(key, sig)
      else await this.indexChat(key, sig)
      // Give way now and then: a first index reads hundreds of files
      if (i % 20 === 19) await new Promise((resolve) => setImmediate(resolve))
    }
    this.indexing = false
  }

  private async indexPaper(id: string, signature: string) {
    const paper = await this.library.get(id)
    if (!paper) return this.db.remove("paper", id)
    const text = await readFile(path.join(paperDir(this.root, id), "text.md"), "utf8").catch(() => "")
    const note = await readFile(path.join(paperStateDir(this.root, id), "note.md"), "utf8").catch(() => "")
    this.db.putPaper(
      {
        id,
        title: paper.title,
        authors: paper.authors.join(", "),
        venue: paper.venue ?? "",
        tags: paper.tags.join(" "),
        ids: [paper.ids.doi, paper.ids.arxiv, id].filter(Boolean).join(" "),
        year: String(paper.year ?? ""),
        abstract: paper.abstract ?? "",
        fulltext: `${text.replace(/<!-- page \d+ -->/g, "")}\n${note}`,
      },
      linksIn(note),
      signature,
    )
  }

  private async indexDoc(rel: string, signature: string) {
    const text = await readFile(path.join(this.root, rel), "utf8").catch(() => undefined)
    if (text === undefined) return this.db.remove("doc", rel)
    const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim()
    const title = heading || path.basename(rel).replace(/\.md$/i, "")
    this.db.putDoc(rel, title, text, linksIn(text), signature)
  }

  private async indexChat(id: string, signature: string) {
    const chat = await readFile(path.join(this.root, OWLIT_DIR, "chats", `${id}.json`), "utf8")
      .then((raw) => JSON.parse(raw) as Chat)
      .catch(() => undefined)
    if (!chat) return this.db.remove("chat", id)
    const texts: string[] = []
    const links = []
    for (const message of chat.messages ?? []) {
      for (const part of message.parts ?? []) if ("text" in part && typeof part.text === "string") texts.push(part.text)
      for (const ref of [...(message.mentions ?? []), ...(message.context ?? [])]) if (ref.uri) links.push({ to: ref.uri, kind: "mention" as const })
    }
    const text = texts.join("\n")
    this.db.putChat(id, chat.title ?? "Chat", text, [...linksIn(text), ...links], signature)
  }

  // Markdown files in the workspace, outside library/ and dot-folders: path → mtime
  private async docFiles() {
    const found = new Map<string, string>()
    const walk = async (rel: string) => {
      const entries = await readdir(path.join(this.root, rel), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.name.startsWith(".") || (!rel && entry.name === "library") || entry.name === "node_modules") continue
        const child = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) await walk(child)
        else if (entry.isFile() && /\.md$/i.test(entry.name)) found.set(child, String((await stat(path.join(this.root, child))).mtimeMs))
      }
    }
    await walk("")
    return found
  }

  private async paperIds() {
    return (await readdir(path.join(this.root, PAPERS_DIR)).catch(() => [] as string[])).filter(isPaperId)
  }

  // A paper changes when its record, text, user state or note does
  private async paperSignature(id: string) {
    const files = [
      path.join(paperDir(this.root, id), "paper.json"),
      path.join(paperDir(this.root, id), "text.md"),
      path.join(paperStateDir(this.root, id), "state.json"),
      path.join(paperStateDir(this.root, id), "note.md"),
    ]
    const times = await Promise.all(files.map((f) => stat(f).then((i) => i.mtimeMs, () => 0)))
    return times.join(":")
  }

  private async chatIds() {
    const dir = path.join(this.root, OWLIT_DIR, "chats")
    const found = new Map<string, string>()
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!name.endsWith(".json") || name === "index.json") continue
      found.set(name.slice(0, -5), String((await stat(path.join(dir, name))).mtimeMs))
    }
    return found
  }
}

export { SETTLE_MS }
