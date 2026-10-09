import {
  baseName,
  cleanName,
  extOf,
  followFirstLine,
  isMarkdown,
  isWithin,
  joinPath,
  parentPath,
  RpcErrorCode,
  uniquePath,
  type DocConflict,
  type DocsChange,
  type DocsListing,
  type AgentNote,
  type DocStat,
  type WorkspaceFile,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { existsSync, watch, type FSWatcher, type Stats } from "node:fs"
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { invalidParams, RpcFailure } from "../rpc/index.ts"
import { Notes } from "./notes.ts"

// What core needs from the machine it runs on that plain Node can't do: the desktop app hands in
// Electron's shell; without one, deleted files go to .owlit/trash/ and nothing opens
export interface Host {
  trash?(absolutePath: string): Promise<void>
  openPath?(absolutePath: string): Promise<void>
}

// .owlit/docs/names.json: docs whose name still follows their first line, with when each was created
// (the time names a doc whose first line is empty; the file's own birth time changes with every save)
interface NamesFile {
  version: 1
  followFirstLine: Record<string, number>
}

// One path as the watcher last saw it. A file changed when any of these differ; a file that turns up
// elsewhere with the same inode was renamed or moved.
interface Entry {
  dir: boolean
  ino: number
  mtimeMs: number
  size: number
  birthtimeMs: number
}

// How long the watcher waits for the file system to go quiet, and the longest it waits while it doesn't
const SETTLE_MS = 100
const MAX_WAIT_MS = 500
// More changes than this at once (a branch switch, a sync) and clients list everything again
const RELOAD_OVER = 200

const notFound = (rel: string) => new RpcFailure(RpcErrorCode.NotFound, `There is no ${rel || "folder"} in the workspace.`, { path: rel })

// The workspace's files as Docs sees them. Every path in and out is workspace-relative and "/"-separated.
// What is read is written back as it was: no line endings touched, no final newline added.
export class Docs {
  private readonly root: string
  private readonly owlitDir: string
  private readonly host: Host
  private readonly notes: Notes
  // path → id, for as long as core runs, so a client's handle on a file survives renames core makes
  private ids = new Map<string, string>()
  private names: NamesFile | undefined
  // Changes run one at a time, so two writers never interleave on the same file
  private queue: Promise<unknown> = Promise.resolve()
  // Every docs path, files and folders, as last seen. Core's own changes are settled into it as they
  // happen, so the watcher finds nothing new when it hears about them: no echo.
  private snapshot = new Map<string, Entry>()
  private watcher: FSWatcher | null = null
  private dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private firstDirtyAt = 0
  // Who hears about changes (set by watch)
  private changed: ((change: DocsChange) => void) | undefined

  constructor(root: string, owlitDir: string, host: Host = {}) {
    this.root = root
    this.owlitDir = owlitDir
    this.host = host
    this.notes = new Notes(owlitDir)
  }

  async list(): Promise<DocsListing> {
    const follow = (await this.loadNames()).followFirstLine
    this.snapshot = await this.scan("")
    const files: WorkspaceFile[] = []
    const folders: string[] = []
    for (const [rel, entry] of this.snapshot) {
      if (entry.dir) folders.push(rel)
      else files.push(await this.fileAt(rel, entry, follow))
    }
    // Forget ids of files that are gone
    for (const p of this.ids.keys()) if (!this.snapshot.has(p)) this.ids.delete(p)
    return { files, folders }
  }

  // Starts hearing about changes made outside core (another editor, Finder, git). Changes come in
  // settled: a burst of events becomes one DocsChange.
  async watch(onChange: (change: DocsChange) => void) {
    if (this.watcher) return
    this.changed = onChange
    if (!this.snapshot.size) this.snapshot = await this.scan("")
    this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      // No name means the system lost track: look at everything
      const rel = filename ? filename.split(path.sep).join("/") : ""
      if (rel && !isDocsPath(rel)) return
      this.dirty.add(rel)
      const now = Date.now()
      if (!this.timer) this.firstDirtyAt = now
      clearTimeout(this.timer)
      const wait = Math.max(0, Math.min(SETTLE_MS, this.firstDirtyAt + MAX_WAIT_MS - now))
      this.timer = setTimeout(() => {
        this.timer = undefined
        const paths = [...this.dirty]
        this.dirty.clear()
        void this.serial(async () => {
          const change = await this.reconcile(paths, true)
          if (change) onChange(change)
        }).catch((error) => console.error("[core] couldn't read changes in the workspace", error))
      }, wait)
    })
    this.watcher.on("error", (error) => console.error("[core] the workspace watcher stopped", error))
  }

  dispose() {
    clearTimeout(this.timer)
    this.watcher?.close()
    this.watcher = null
  }

  async read(rel: string) {
    const file = this.abs(this.check(rel))
    try {
      const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)])
      return { content, modifiedAt: info.mtimeMs }
    } catch {
      throw notFound(rel)
    }
  }

  create(rel: string, content: string, options: { id?: string; followsFirstLine?: boolean } = {}) {
    return this.serial(async () => {
      this.check(rel)
      if (!isMarkdown(rel)) throw invalidParams(`${baseName(rel)} is not a Markdown file.`)
      const now = Date.now()
      let target = options.followsFirstLine ? followFirstLine(rel, content, now, this.taken()) ?? rel : rel
      if (this.taken()(target)) target = uniquePath(parentPath(target), stemOf(target), ".md", this.taken())
      await mkdir(path.dirname(this.abs(target)), { recursive: true })
      await writeFile(this.abs(target), content, { flag: "wx" })
      if (options.id) this.ids.set(target, options.id)
      if (options.followsFirstLine) await this.updateNames((f) => ({ ...f, [target]: now }))
      await this.settle([target])
      return this.statAt(target)
    })
  }

  write(rel: string, content: string, expectedModifiedAt: number, force = false) {
    return this.serial(async () => {
      this.check(rel)
      const file = this.abs(rel)
      const info = await stat(file).catch(() => null)
      if (!info) throw conflict({ path: rel, content: null, modifiedAt: null })
      if (!force && info.mtimeMs !== expectedModifiedAt) {
        throw conflict({ path: rel, content: await readFile(file, "utf8"), modifiedAt: info.mtimeMs })
      }
      await writeInPlace(file, content)
      // A doc that was never renamed by hand takes its name from its first line
      const follow = (await this.loadNames()).followFirstLine
      let at = rel
      if (follow[rel] !== undefined) {
        const to = followFirstLine(rel, content, follow[rel], this.taken(rel))
        if (to) at = await this.moveEntry(rel, to)
      }
      await this.settle([rel, at])
      return this.statAt(at)
    })
  }

  rename(rel: string, name: string) {
    return this.serial(async () => {
      const info = await this.entry(rel)
      const ext = info.isDirectory() ? "" : extOf(rel)
      const stem = cleanName(ext === ".md" ? name.replace(/\.md$/i, "") : name.endsWith(ext) ? name.slice(0, name.length - ext.length) : name)
      if (!stem) throw invalidParams("That name has nothing in it a file name can use.")
      const wanted = joinPath(parentPath(rel), stem + ext)
      if (wanted === rel) return { path: rel }
      // A change of case only is the same entry, so it can't collide with itself
      const to = wanted.toLowerCase() === rel.toLowerCase() ? wanted : uniquePath(parentPath(rel), stem, ext, this.taken())
      const at = await this.moveEntry(rel, to)
      await this.updateNames((f) => dropUnder(f, at))
      await this.settle([rel, at])
      return { path: at }
    })
  }

  move(rel: string, folder: string) {
    return this.serial(async () => {
      const info = await this.entry(rel)
      if (folder) {
        this.check(folder)
        if (!(await stat(this.abs(folder)).catch(() => null))?.isDirectory()) throw notFound(folder)
      }
      if (parentPath(rel) === folder) return { path: rel }
      if (info.isDirectory() && isWithin(folder, rel)) throw invalidParams(`${baseName(rel)} can't go inside itself.`)
      const ext = info.isDirectory() ? "" : extOf(rel)
      const name = baseName(rel)
      const to = uniquePath(folder, ext ? name.slice(0, -ext.length) : name, ext, this.taken())
      await this.moveEntry(rel, to)
      await this.settle([rel, to])
      return { path: to }
    })
  }

  delete(rel: string) {
    return this.serial(async () => {
      await this.entry(rel)
      const file = this.abs(rel)
      if (this.host.trash) await this.host.trash(file)
      else await this.moveToOwlitTrash(rel)
      await this.notes.trash(rel)
      for (const p of [...this.ids.keys()]) if (isWithin(p, rel)) this.ids.delete(p)
      await this.updateNames((f) => dropUnder(f, rel))
      await this.settle([rel])
      return null
    })
  }

  createFolder(rel: string) {
    return this.serial(async () => {
      this.check(rel)
      const at = this.taken()(rel) ? uniquePath(parentPath(rel), baseName(rel), "", this.taken()) : rel
      await mkdir(this.abs(at), { recursive: true })
      await this.settle([at])
      return { path: at }
    })
  }

  restore(files: { id: string; path: string; content: string }[], folders: string[]) {
    return this.serial(async () => {
      const made: string[] = []
      for (const folder of [...folders].sort()) {
        this.check(folder)
        await mkdir(this.abs(folder), { recursive: true })
        made.push(folder)
      }
      const restored: DocStat[] = []
      for (const file of files) {
        this.check(file.path)
        const at = this.taken()(file.path) ? uniquePath(parentPath(file.path), stemOf(file.path), extOf(file.path), this.taken()) : file.path
        await mkdir(path.dirname(this.abs(at)), { recursive: true })
        await writeFile(this.abs(at), file.content, { flag: "wx" })
        await this.notes.untrash(file.path, at)
        this.ids.set(at, file.id)
        restored.push(await this.statAt(at))
      }
      await this.settle([...made, ...restored.map((f) => f.path)])
      return { files: restored, folders: made }
    })
  }

  // ---- What agents read and write (ACP fs/read_text_file, fs/write_text_file). Absolute paths, as ACP
  // gives them, anywhere inside the workspace; writes not into .owlit/.

  agentRead(file: string, line?: number, limit?: number) {
    return this.serial(async () => {
      const rel = this.inside(file)
      let content: string
      try {
        content = await readFile(this.abs(rel), "utf8")
      } catch {
        throw notFound(rel)
      }
      if (line === undefined && limit === undefined) return { content }
      // line is 1-based; limit counts lines
      const lines = content.split("\n")
      const start = Math.max(0, (line ?? 1) - 1)
      return { content: lines.slice(start, limit === undefined ? undefined : start + limit).join("\n") }
    })
  }

  // A write by an agent reaches clients as a change made outside them (docs.changed)
  agentWrite(file: string, content: string) {
    return this.serial(async () => {
      const rel = this.inside(file)
      if (rel.split("/")[0] === ".owlit") throw new RpcFailure(RpcErrorCode.InvalidParams, "Agents can't write inside .owlit.", { path: rel })
      if (existsSync(this.abs(rel))) await writeInPlace(this.abs(rel), content)
      else {
        await mkdir(path.dirname(this.abs(rel)), { recursive: true })
        await writeFile(this.abs(rel), content)
      }
      const change = await this.reconcile([rel], true)
      if (change) this.changed?.(change)
      return null
    })
  }

  // ---- Agents' notes on docs (./notes.ts), kept in step with the files they belong to ----

  notesAll() {
    return this.serial(() => this.notes.all())
  }

  addNote(rel: string, note: AgentNote) {
    return this.serial(async () => {
      await this.notes.add(this.check(rel), note)
      return null
    })
  }

  removeNote(rel: string, id: string) {
    return this.serial(() => this.notes.remove(this.check(rel), id))
  }

  reanchorNotes(rel: string, moved: Record<string, Pick<AgentNote, "quote" | "prefix" | "suffix">>) {
    return this.serial(async () => {
      await this.notes.reanchor(this.check(rel), moved)
      return null
    })
  }

  async open(rel: string) {
    await this.entry(rel)
    if (!this.host.openPath) throw new RpcFailure(RpcErrorCode.InternalError, "owlit can't open files in other apps here.")
    await this.host.openPath(this.abs(rel))
    return null
  }

  // ---- inside ----

  // Every docs path under rel (rel itself not included), as it is on disk now
  private async scan(rel: string) {
    const found = new Map<string, Entry>()
    const walk = async (dir: string) => {
      const entries = await readdir(this.abs(dir), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const child = joinPath(dir, entry.name)
        if (!isDocsPath(child)) continue
        // Symlinked folders are not followed, so a link back up can't loop; a symlinked file is read through
        if (entry.isDirectory()) {
          const info = await lstat(this.abs(child)).catch(() => null)
          if (info) found.set(child, entryOf(info, true))
          await walk(child)
          continue
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        const info = await stat(this.abs(child)).catch(() => null)
        if (info?.isFile()) found.set(child, entryOf(info, false))
      }
    }
    await walk(rel)
    return found
  }

  // What is at rel now: nothing, a file, or a folder with everything under it
  private async look(rel: string) {
    if (!rel) return this.scan("")
    const found = new Map<string, Entry>()
    const link = await lstat(this.abs(rel)).catch(() => null)
    if (!link) return found
    if (link.isDirectory()) {
      found.set(rel, entryOf(link, true))
      for (const [p, e] of await this.scan(rel)) found.set(p, e)
      return found
    }
    const info = link.isSymbolicLink() ? await stat(this.abs(rel)).catch(() => null) : link
    if (info?.isFile()) found.set(rel, entryOf(info, false))
    return found
  }

  // Core changed these paths itself: the snapshot takes them in without telling anyone
  private async settle(paths: string[]) {
    if (this.watcher || this.snapshot.size) await this.reconcile(paths, false)
  }

  // Brings the snapshot up to date for these paths and says what changed. A file gone from one path and
  // found at another with the same inode was renamed: it keeps its id. Changes made outside core count
  // as the user's own hand, so a renamed doc stops following its first line.
  private async reconcile(paths: string[], external: boolean): Promise<DocsChange | null> {
    const removed = new Map<string, Entry>()
    const added = new Map<string, Entry>()
    const modified = new Set<string>()
    // A path under another one in the list is covered by it
    const roots = [...new Set(paths)].filter((p, _, all) => !all.some((q) => q !== p && (q === "" || isWithin(p, q))))
    for (const rel of roots) {
      const now = await this.look(rel)
      for (const [p, e] of this.snapshot) {
        if ((rel === "" || isWithin(p, rel)) && !now.has(p)) {
          removed.set(p, e)
          this.snapshot.delete(p)
        }
      }
      for (const [p, e] of now) {
        const before = this.snapshot.get(p)
        if (!before) added.set(p, e)
        else if (before.dir !== e.dir) {
          removed.set(p, before)
          added.set(p, e)
        } else if (!e.dir && (before.ino !== e.ino || before.mtimeMs !== e.mtimeMs || before.size !== e.size)) modified.add(p)
        this.snapshot.set(p, e)
      }
    }
    // Renames, paired by inode
    const byIno = new Map([...removed].filter(([, e]) => !e.dir).map(([p, e]) => [e.ino, p]))
    const renamedFrom = new Set<string>()
    for (const [p, e] of added) {
      const from = e.dir ? undefined : byIno.get(e.ino)
      if (from === undefined) continue
      renamedFrom.add(from)
      if (external) await this.notes.move(from, p)
      const id = this.ids.get(from)
      if (id) {
        this.ids.delete(from)
        this.ids.set(p, id)
      }
    }
    if (!external) return null
    const follow = (await this.loadNames()).followFirstLine
    if (removed.size) await this.updateNames((f) => Object.fromEntries(Object.entries(f).filter(([p]) => !removed.has(p))))
    const count = removed.size + added.size + modified.size
    if (!count) return null
    if (count > RELOAD_OVER) return { changed: [], deleted: [], folders: { created: [], deleted: [] }, reload: true }
    const change: DocsChange = { changed: [], deleted: [], folders: { created: [], deleted: [] } }
    for (const [p, e] of removed) {
      if (e.dir) change.folders.deleted.push(p)
      else if (!renamedFrom.has(p)) {
        change.deleted.push({ id: this.ids.get(p) ?? "", path: p })
        this.ids.delete(p)
      }
    }
    for (const [p, e] of added) {
      if (e.dir) change.folders.created.push(p)
      else change.changed.push(await this.fileAt(p, e, follow))
    }
    for (const p of modified) change.changed.push(await this.fileAt(p, this.snapshot.get(p)!, follow))
    return change
  }

  // A file in the snapshot as clients see it, with its text when it is Markdown
  private async fileAt(rel: string, entry: Entry, follow: Record<string, number>): Promise<WorkspaceFile> {
    const file: WorkspaceFile = this.statOf(rel, entry.mtimeMs, follow[rel] ?? entry.birthtimeMs)
    if (isMarkdown(rel)) file.content = await readFile(this.abs(rel), "utf8").catch(() => "")
    return file
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  // A path a client may name: inside the workspace, not under library/ or a dot-folder
  private check(rel: string) {
    if (!isDocsPath(rel) || path.posix.normalize(rel) !== rel || rel.startsWith("/")) {
      throw invalidParams(`${rel || "The workspace root"} is outside what Docs can reach.`, { path: rel })
    }
    return rel
  }

  // A path an agent named: absolute (or relative to the workspace), resolved, and inside the workspace
  private inside(file: string) {
    const resolved = path.resolve(this.root, file)
    const rel = path.relative(this.root, resolved)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new RpcFailure(RpcErrorCode.InvalidParams, `${file} is outside the workspace.`, { path: file })
    }
    return rel.split(path.sep).join("/")
  }

  private abs(rel: string) {
    return path.join(this.root, ...rel.split("/").filter(Boolean))
  }

  private async entry(rel: string) {
    this.check(rel)
    const info = await lstat(this.abs(rel)).catch(() => null)
    if (!info) throw notFound(rel)
    return info
  }

  // Whether a path is in use on disk; `self` is the file asking, which never collides with itself
  private taken(self?: string) {
    return (rel: string) => rel !== self && existsSync(this.abs(rel))
  }

  private idOf(rel: string) {
    let id = this.ids.get(rel)
    if (!id) {
      id = randomUUID()
      this.ids.set(rel, id)
    }
    return id
  }

  private statOf(rel: string, modifiedAt: number, createdAt: number): DocStat {
    const follows = this.names?.followFirstLine[rel] !== undefined
    return { id: this.idOf(rel), path: rel, createdAt, modifiedAt, ...(isMarkdown(rel) ? { nameLocked: !follows } : {}) }
  }

  private async statAt(rel: string): Promise<DocStat> {
    const info = await stat(this.abs(rel))
    const follow = (await this.loadNames()).followFirstLine
    return this.statOf(rel, info.mtimeMs, follow[rel] ?? info.birthtimeMs)
  }

  // Renames on disk and carries ids and first-line naming along, for a file or everything in a folder
  private async moveEntry(from: string, to: string) {
    await mkdir(path.dirname(this.abs(to)), { recursive: true })
    await rename(this.abs(from), this.abs(to))
    await this.notes.move(from, to)
    const swap = (p: string) => (isWithin(p, from) ? to + p.slice(from.length) : p)
    this.ids = new Map([...this.ids].map(([p, id]) => [swap(p), id]))
    await this.updateNames((f) => Object.fromEntries(Object.entries(f).map(([p, t]) => [swap(p), t])))
    return to
  }

  private async moveToOwlitTrash(rel: string) {
    const to = path.join(this.owlitDir, "trash", `${Date.now()}-docs`, ...rel.split("/"))
    await mkdir(path.dirname(to), { recursive: true })
    await rename(this.abs(rel), to)
  }

  private get namesFile() {
    return path.join(this.owlitDir, "docs", "names.json")
  }

  private async loadNames() {
    if (!this.names) {
      const stored = await readJson<NamesFile>(this.namesFile).catch(() => undefined)
      this.names = { version: 1, followFirstLine: stored?.followFirstLine ?? {} }
    }
    return this.names
  }

  private async updateNames(change: (follow: Record<string, number>) => Record<string, number>) {
    const names = await this.loadNames()
    const next = change(names.followFirstLine)
    const same = Object.keys(next).length === Object.keys(names.followFirstLine).length && Object.entries(next).every(([p, t]) => names.followFirstLine[p] === t)
    if (same) return
    this.names = { version: 1, followFirstLine: next }
    await writeJsonAtomic(this.namesFile, this.names)
  }
}

// Paths Docs reaches: anything in the workspace but library/ (the Library's) and dot-folders. knowledge/
// is listed too: Docs hides it in its tree, Knowledge reads its topics from it.
export function isDocsPath(rel: string) {
  const segments = rel.split("/")
  if (segments.some((s) => !s || s === "." || s === ".." || s.startsWith("."))) return false
  return segments[0] !== "library"
}

const entryOf = (info: Stats, dir: boolean): Entry => ({
  dir,
  ino: info.ino,
  mtimeMs: info.mtimeMs,
  size: dir ? 0 : info.size,
  birthtimeMs: info.birthtimeMs,
})

const stemOf = (rel: string) => {
  const name = baseName(rel)
  const ext = extOf(rel)
  return ext ? name.slice(0, -ext.length) : name
}

const dropUnder = (follow: Record<string, number>, rel: string) =>
  Object.fromEntries(Object.entries(follow).filter(([p]) => !isWithin(p, rel)))

const conflict = (data: DocConflict) =>
  new RpcFailure(
    RpcErrorCode.Conflict,
    data.content === null ? `${baseName(data.path)} is no longer on disk.` : `${baseName(data.path)} changed on disk.`,
    data,
  )

// Replaces a file's text through a temp file and a rename, so a crash never leaves half a file. The
// temp file takes the original's permissions, and a symlink is written through rather than replaced.
async function writeInPlace(file: string, content: string) {
  const target = await realpath(file)
  const { mode } = await stat(target)
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID().slice(0, 8)}.tmp`)
  try {
    await writeFile(tmp, content)
    await chmod(tmp, mode)
    await rename(tmp, target)
  } catch (error) {
    await unlink(tmp).catch(() => undefined)
    throw error
  }
}
