import { t } from "@lingui/core/macro"
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
  type CommentAnchor,
  type DocComment,
  type DocStat,
  type WorkspaceFile,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { existsSync, lstatSync, realpathSync, watch, type FSWatcher, type Stats } from "node:fs"
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { invalidParams, RpcFailure, WINDOW, type Caller } from "../rpc/index.ts"
import { Comments } from "./comments.ts"
import type { Host } from "../host.ts"
import { Serial } from "../util.ts"
import { isOwlitPath } from "../workspace/paths.ts"

// What core needs from the machine it runs on that plain Node can't do: the desktop app hands in
// Electron's shell; without one, deleted files go to .owlit/trash/ and nothing opens

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

const notFound = (rel: string) => new RpcFailure(RpcErrorCode.NotFound, rel ? t`There is no ${rel} in the workspace.` : t`There is no folder in the workspace.`, { path: rel })

// The workspace's files as Docs sees them. Every path in and out is workspace-relative and "/"-separated.
// What is read is written back as it was: no line endings touched, no final newline added.
export class Docs {
  private readonly root: string
  private readonly owlitDir: string
  private readonly host: Host
  private readonly comments: Comments
  // path → id, for as long as core runs, so a client's handle on a file survives renames core makes
  private ids = new Map<string, string>()
  private names: NamesFile | undefined
  // Changes run one at a time, so two writers never interleave on the same file
  private readonly serial = new Serial()
  // Every docs path, files and folders, as last seen. Core's own changes are settled into it as they
  // happen, so the watcher finds nothing new when it hears about them: no echo.
  private snapshot = new Map<string, Entry>()
  private watcher: FSWatcher | null = null
  private dirty = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private firstDirtyAt = 0
  // Who hears about changes (set by watch)
  private changed: ((change: DocsChange) => void) | undefined
  // Every Markdown file's text as last seen, so a change made outside core still knows what was there
  private texts = new Map<string, string>()
  // Paths core is writing for someone it records itself (an agent's write, an undo), whose change the
  // reconcile that follows must not report as made outside
  private writing = new Set<string>()
  // A file's text changed outside core (null: there was none / there is none now): another program, an
  // agent writing the disk itself. Awaited, so what it records lands before what core does next.
  textChanged: ((rel: string, before: string | null, after: string | null) => unknown) | undefined
  // A doc was saved through write (the window's save, or a program's on the socket, as caller): its text
  // before and after, once it is on disk, and where it is now (a doc named by its first line may have
  // moved). Awaited, after any change made outside since the caller last read the doc has been through
  // textChanged.
  saved: ((rel: string, before: string | null, after: string, at: string, caller: Caller) => unknown) | undefined

  constructor(root: string, owlitDir: string, host: Host = {}) {
    this.root = root
    this.owlitDir = owlitDir
    this.host = host
    this.comments = new Comments(owlitDir)
  }

  // A Markdown file's text as owlit last saw it, before any write it hasn't heard of yet
  knownText(rel: string): string | undefined {
    return this.texts.get(rel)
  }

  // In turn with the watcher's reads: a change it heard but hasn't read yet is read (and told) first,
  // so an agent's edit can't slip into the listing without its version being kept
  list(): Promise<DocsListing> {
    return this.serial.run(async () => {
      await this.readHeard()
      const follow = (await this.loadNames()).followFirstLine
      this.snapshot = await this.scan("")
      this.texts.clear()
      const files: WorkspaceFile[] = []
      const folders: string[] = []
      for (const [rel, entry] of this.snapshot) {
        if (entry.dir) folders.push(rel)
        else {
          files.push(await this.fileAt(rel, entry, follow))
          // Other text files' texts are kept too, for the version an agent's change of them keeps
          if (keepsText(rel, entry) && !isMarkdown(rel)) {
            const text = await readFile(this.abs(rel), "utf8").catch(() => null)
            if (text !== null) this.texts.set(rel, text)
          }
        }
      }
      // Forget ids of files that are gone
      for (const p of this.ids.keys()) if (!this.snapshot.has(p)) this.ids.delete(p)
      return { files, folders }
    })
  }

  // Every docs file with its mtime, as the snapshot has it once what the watcher heard is read: no file's
  // text is read. Scanned afresh while nothing has been seen (no watcher, nothing listed yet).
  files(): Promise<{ path: string; modifiedAt: number }[]> {
    return this.serial.run(async () => {
      await this.readHeard()
      const entries = this.snapshot.size ? this.snapshot : await this.scan("")
      return [...entries].flatMap(([rel, e]) => (e.dir ? [] : [{ path: rel, modifiedAt: e.mtimeMs }]))
    })
  }

  // Reads (and tells) a change the watcher heard that is still waiting to settle. Runs in the serial turn.
  private async readHeard() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = undefined
    const paths = [...this.dirty]
    this.dirty.clear()
    const change = await this.reconcile(paths, true)
    if (change) this.changed?.(change)
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
        void this.serial.run(async () => {
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
    return this.serial.run(async () => {
      this.check(rel)
      if (!isMarkdown(rel)) {
        const name = baseName(rel)
        throw invalidParams(t`${name} is not a Markdown file.`)
      }
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

  write(rel: string, content: string, expectedModifiedAt: number, force = false, caller: Caller = WINDOW) {
    return this.serial.run(async () => {
      this.check(rel)
      const file = this.abs(rel)
      const info = await stat(file).catch(() => null)
      if (!info) throw conflict({ path: rel, content: null, modifiedAt: null })
      if (info.mtimeMs !== expectedModifiedAt) {
        const theirs = await readFile(file, "utf8")
        if (!force) throw conflict({ path: rel, content: theirs, modifiedAt: info.mtimeMs })
        // Keep mine: the other program's text is reported as its own change first (the watcher may not
        // have settled it yet), so the save stands on top of it rather than in its place
        await this.reconcile([rel], true, false)
      }
      const before = this.texts.get(rel) ?? (await this.readDisk(rel))
      await writeInPlace(file, content)
      // A doc that was never renamed by hand takes its name from its first line
      const follow = (await this.loadNames()).followFirstLine
      let at = rel
      if (follow[rel] !== undefined) {
        const to = followFirstLine(rel, content, follow[rel], this.taken(rel))
        if (to) at = await this.moveEntry(rel, to)
      }
      await this.settle([rel, at])
      await this.saved?.(rel, before, content, at, caller)
      return this.statAt(at)
    })
  }

  // `told`: the change is someone else's than the window asking (an agent's), so windows hear about it
  rename(rel: string, name: string, told = false) {
    return this.serial.run(async () => {
      const info = await this.entry(rel)
      const ext = info.isDirectory() ? "" : extOf(rel)
      const stem = cleanName(ext === ".md" ? name.replace(/\.md$/i, "") : name.endsWith(ext) ? name.slice(0, name.length - ext.length) : name)
      if (!stem) throw invalidParams(t`That name has nothing in it a file name can use.`)
      const wanted = joinPath(parentPath(rel), stem + ext)
      if (wanted === rel) return { path: rel }
      // A change of case or of Unicode form only is the same entry on a disk that ignores them, so it
      // can't collide with itself; where the disk tells them apart, a file already there is another one
      const to = (await this.sameEntry(rel, wanted)) ? wanted : uniquePath(parentPath(rel), stem, ext, this.taken())
      const at = await this.moveEntry(rel, to)
      await this.updateNames((f) => dropUnder(f, at))
      await this.settle([rel, at], told)
      return { path: at }
    })
  }

  move(rel: string, folder: string, told = false) {
    return this.serial.run(async () => {
      const info = await this.entry(rel)
      if (folder) {
        this.check(folder)
        if (!(await stat(this.abs(folder)).catch(() => null))?.isDirectory()) throw notFound(folder)
      }
      if (parentPath(rel) === folder) return { path: rel }
      const name = baseName(rel)
      if (info.isDirectory() && isWithin(folder, rel)) throw invalidParams(t`${name} can't go inside itself.`)
      const ext = info.isDirectory() ? "" : extOf(rel)
      const to = uniquePath(folder, ext ? name.slice(0, -ext.length) : name, ext, this.taken())
      await this.moveEntry(rel, to)
      await this.settle([rel, to], told)
      return { path: to }
    })
  }

  delete(rel: string, told = false) {
    return this.serial.run(async () => {
      await this.entry(rel)
      const file = this.abs(rel)
      if (this.host.trash) await this.host.trash(file)
      else await this.moveToOwlitTrash(rel)
      await this.comments.trash(rel)
      await this.updateNames((f) => dropUnder(f, rel))
      // Before the ids go, so a told delete names the docs by them
      await this.settle([rel], told)
      for (const p of [...this.ids.keys()]) if (isWithin(p, rel)) this.ids.delete(p)
      return null
    })
  }

  createFolder(rel: string) {
    return this.serial.run(async () => {
      this.check(rel)
      const at = this.taken()(rel) ? uniquePath(parentPath(rel), baseName(rel), "", this.taken()) : rel
      await mkdir(this.abs(at), { recursive: true })
      await this.settle([at])
      return { path: at }
    })
  }

  // A folder an agent moves a doc into: made, with its parents, only where there is none yet (and told)
  ensureFolder(rel: string) {
    return this.serial.run(async () => {
      this.check(rel)
      if ((await stat(this.abs(rel)).catch(() => null))?.isDirectory()) return
      // The first folder made, which holds any made under it
      const made = await mkdir(this.abs(rel), { recursive: true })
      if (made) await this.settle([path.relative(this.root, made).split(path.sep).join("/")], true)
    })
  }

  restore(files: { id: string; path: string; content: string }[], folders: string[]) {
    return this.serial.run(async () => {
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
        await this.comments.untrash(file.path, at)
        this.ids.set(at, file.id)
        restored.push(await this.statAt(at))
      }
      await this.settle([...made, ...restored.map((f) => f.path)])
      return { files: restored, folders: made }
    })
  }

  // ---- Files outside Docs' own calls: what agents read and write (agents/fs.ts) and Undo puts back.
  // Paths anywhere inside the workspace; changes reach clients as made outside them (docs.changed).

  // A path an agent named (absolute, or relative to the workspace) as a workspace-relative one; refused
  // outside the workspace
  resolve(file: string) {
    return this.inside(file)
  }

  // The files at or under a path whose text is kept, with their text: what an agent's delete or move keeps
  // so it can be undone
  async textsUnder(rel: string) {
    const out: { path: string; content: string }[] = []
    for (const [p, e] of this.snapshot) {
      if (e.dir || !(p === rel || isWithin(p, rel)) || !keepsText(p, e)) continue
      const content = await this.readDisk(p)
      if (content !== null) out.push({ path: p, content })
    }
    return out
  }

  // The path "<folder>/<stem><ext>", or the first "<stem> 2<ext>"… after it that nothing is at
  freePath(folder: string, stem: string, ext: string) {
    return uniquePath(folder, cleanName(stem) || "Untitled", ext, this.taken())
  }

  // A file's text on disk, or null when there is none
  readDisk(rel: string) {
    return readFile(this.abs(rel), "utf8").catch(() => null)
  }

  writeTold(rel: string, content: string) {
    return this.serial.run(async () => {
      if (existsSync(this.abs(rel))) await writeInPlace(this.abs(rel), content)
      else {
        await mkdir(path.dirname(this.abs(rel)), { recursive: true })
        await writeFile(this.abs(rel), content)
      }
      await this.tell(rel)
    })
  }

  removeTold(rel: string) {
    return this.serial.run(async () => {
      if (!existsSync(this.abs(rel))) return
      if (this.host.trash) await this.host.trash(this.abs(rel))
      else await this.moveToOwlitTrash(rel)
      await this.tell(rel)
    })
  }

  // Windows hear about a change core made for someone else; whoever asked for it records it
  private async tell(rel: string) {
    this.writing.add(rel)
    try {
      const change = await this.reconcile([rel], true)
      if (change) this.changed?.(change)
    } finally {
      this.writing.delete(rel)
    }
  }

  // ---- Comments on docs (./comments.ts), kept in step with the files they belong to ----

  commentsAll() {
    return this.serial.run(() => this.comments.all())
  }

  listComments(rel: string) {
    return this.serial.run(() => this.comments.list(this.check(rel)))
  }

  addComment(rel: string, comment: DocComment) {
    return this.serial.run(async () => {
      await this.comments.add(this.check(rel), comment)
      return null
    })
  }

  putComment(rel: string, comment: DocComment) {
    return this.serial.run(() => this.comments.put(this.check(rel), comment))
  }

  // Changes one comment in its turn, from how it reads then (null: it isn't there); the comment as it was
  // and as it is now
  updateComment(rel: string, id: string, change: (was: DocComment | null) => DocComment) {
    return this.serial.run(async () => {
      const at = this.check(rel)
      const before = (await this.comments.list(at)).find((c) => c.id === id) ?? null
      const after = change(before)
      await this.comments.put(at, after)
      return { before, after }
    })
  }

  removeComment(rel: string, id: string) {
    return this.serial.run(() => this.comments.remove(this.check(rel), id))
  }

  reanchorComments(rel: string, moved: Record<string, CommentAnchor>) {
    return this.serial.run(async () => {
      await this.comments.reanchor(this.check(rel), moved)
      return null
    })
  }

  // A document opens in its app; anything else (a folder, which may be an .app, a .command, a .terminal) is
  // shown in Finder instead, since agents can write files here and one click must not run one
  async open(rel: string) {
    await this.entry(rel)
    // Judged by what a link leads to: notes.pdf -> Tool.app is an app
    const target = await realpath(this.abs(rel))
    if ((await stat(target)).isDirectory() || !OPENS.test(target)) return this.reveal(rel)
    if (!this.host.openPath) throw new RpcFailure(RpcErrorCode.InternalError, t`owlit can't open files in other apps here.`)
    await this.host.openPath(this.abs(rel))
    return null
  }

  async reveal(rel: string) {
    await this.entry(rel)
    if (!this.host.revealPath) throw new RpcFailure(RpcErrorCode.InternalError, t`owlit can't show files in Finder here.`)
    this.host.revealPath(this.abs(rel))
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
        // when it leads to a doc in the workspace
        if (entry.isDirectory()) {
          const info = await lstat(this.abs(child)).catch(() => null)
          if (info) found.set(child, entryOf(info, true))
          await walk(child)
          continue
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        if (entry.isSymbolicLink() && !isDocsPath(this.realRel(child) ?? "..")) continue
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
    // macOS finds a.md under A.md too: after a rename that changed only the case, the old name is gone
    // even though lstat still answers for it
    const names = await readdir(path.dirname(this.abs(rel))).catch(() => [] as string[])
    const name = path.basename(this.abs(rel)).normalize("NFC")
    if (!names.some((n) => n.normalize("NFC") === name)) return found
    if (link.isDirectory()) {
      found.set(rel, entryOf(link, true))
      for (const [p, e] of await this.scan(rel)) found.set(p, e)
      return found
    }
    const info = link.isSymbolicLink() ? await stat(this.abs(rel)).catch(() => null) : link
    if (info?.isFile()) found.set(rel, entryOf(info, false))
    return found
  }

  // Core changed these paths itself: the snapshot takes them in, so the watcher finds nothing new. Windows
  // are told only when the change wasn't asked for by one (`told`: an agent's); a window that asked has
  // already made it in its store.
  private async settle(paths: string[], told = false) {
    if (!this.watcher && !this.snapshot.size) return
    const change = await this.reconcile(paths, false, told)
    if (change) this.changed?.(change)
  }

  // Brings the snapshot up to date for these paths and says what changed. A file gone from one path and
  // found at another with the same inode was renamed: it keeps its id. Changes made outside core count
  // as the user's own hand, so a renamed doc stops following its first line.
  // `report` says what changed even when core made the change (an agent's move, told to windows).
  private async reconcile(paths: string[], external: boolean, report = external): Promise<DocsChange | null> {
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
      if (external) {
        await this.comments.move(from, p)
      }
      const id = this.ids.get(from)
      if (id) {
        this.ids.delete(from)
        this.ids.set(p, id)
      }
    }
    // Texts follow renames; changed and new Markdown is read again; outside changes are reported
    // A move made outside core is told as the old path gone and the new one made, so it can be undone
    for (const [p, e] of added) {
      const from = e.dir ? undefined : byIno.get(e.ino)
      const moved = from !== undefined ? this.texts.get(from) : undefined
      if (moved !== undefined) {
        this.texts.delete(from!)
        this.texts.set(p, moved)
        if (external) {
          await this.outside(from!, moved, null)
          await this.outside(p, null, moved)
        }
      }
    }
    for (const [p, e] of removed) {
      if (e.dir || renamedFrom.has(p) || !keepsText(p, e)) continue
      const before = this.texts.get(p)
      this.texts.delete(p)
      // A file whose text was never read can't be put back, so it isn't offered
      if (external && before !== undefined) await this.outside(p, before, null)
    }
    for (const p of new Set([...[...added].filter(([, e]) => !e.dir).map(([p]) => p), ...modified])) {
      if (!keepsText(p, this.snapshot.get(p))) continue
      const before = this.texts.get(p)
      const after = await readFile(this.abs(p), "utf8").catch(() => null)
      if (after === null) continue
      this.texts.set(p, after)
      // A file that was there but whose text was never read: what it was is unknown, not "nothing"
      // (taking it for nothing would make Undo delete it)
      if (before === undefined && modified.has(p)) continue
      if (external && before !== after) await this.outside(p, before ?? null, after)
    }
    if (!report) return null
    const follow = (await this.loadNames()).followFirstLine
    if (external && removed.size) await this.updateNames((f) => Object.fromEntries(Object.entries(f).filter(([p]) => !removed.has(p))))
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

  private async outside(rel: string, before: string | null, after: string | null) {
    if (!this.writing.has(rel)) await this.textChanged?.(rel, before, after)
  }

  // A file in the snapshot as clients see it, with its text when it is Markdown
  private async fileAt(rel: string, entry: Entry, follow: Record<string, number>): Promise<WorkspaceFile> {
    const file: WorkspaceFile = this.statOf(rel, entry.mtimeMs, follow[rel] ?? entry.birthtimeMs)
    if (isMarkdown(rel)) {
      file.content = this.texts.get(rel) ?? (await readFile(this.abs(rel), "utf8").catch(() => ""))
      this.texts.set(rel, file.content)
    }
    return file
  }

  // A path a client may name: inside the workspace, not under library/ or a dot-folder, where it is
  // written and where it really is
  private check(rel: string) {
    const real = path.posix.normalize(rel) === rel && !rel.startsWith("/") && isDocsPath(rel) ? this.realRel(rel) : null
    if (real === null || !isDocsPath(real)) {
      throw invalidParams(rel ? t`${rel} is outside what Docs can reach.` : t`The workspace root is outside what Docs can reach.`, { path: rel })
    }
    return rel
  }

  // A path an agent named: absolute (or relative to the workspace), resolved, and inside the workspace
  private inside(file: string) {
    const resolved = path.resolve(this.root, file)
    const rel = path.relative(this.root, resolved)
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new RpcFailure(RpcErrorCode.InvalidParams, t`${file} is outside the workspace.`, { path: file })
    }
    if (this.realRel(rel) === null) {
      throw new RpcFailure(RpcErrorCode.InvalidParams, t`${file} leads outside the workspace.`, { path: file })
    }
    return rel.split(path.sep).join("/")
  }

  // Whether a workspace path is one of the user's docs, as written and where it really is
  isDoc(rel: string) {
    const real = this.realRel(rel)
    return isDocsPath(rel) && real !== null && isDocsPath(real)
  }

  // Whether a workspace path is owlit's own (library/, .owlit/) as written or where it really is, so a link
  // (state -> .owlit) doesn't get past
  isOwlits(rel: string) {
    return isOwlitPath(rel) || isOwlitPath(this.realRel(rel) ?? "")
  }

  // Where a path in the workspace really is, relative to it; null when a symlink on the way
  // (notes.md -> ~/.zshrc) leads outside it, or to nothing
  private realRel(rel: string) {
    const target = realOfDeepest(this.abs(rel))
    if (target === null) return null
    const real = path.relative(realpathSync(this.root), target)
    return real.startsWith("..") || path.isAbsolute(real) ? null : real.split(path.sep).join("/")
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
  private async sameEntry(a: string, b: string) {
    const [x, y] = await Promise.all([lstat(this.abs(a)).catch(() => null), lstat(this.abs(b)).catch(() => null)])
    return !!x && !!y && x.ino === y.ino && x.dev === y.dev
  }

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
    await this.comments.move(from, to)
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

// Paths Docs reaches: anything in the workspace but library/ (the Library's) and dot-folders.
export function isDocsPath(rel: string) {
  const segments = rel.split("/")
  if (segments.some((s) => !s || s === "." || s === ".." || s.startsWith("."))) return false
  return !isOwlitPath(rel)
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

const conflict = (data: DocConflict) => {
  const name = baseName(data.path)
  return new RpcFailure(RpcErrorCode.Conflict, data.content === null ? t`${name} is no longer on disk.` : t`${name} changed on disk.`, data)
}

// Files Docs opens in their own app: documents, pictures, sound and video. Not web pages, scripts or
// anything macOS runs.
const OPENS = /\.(pdf|txt|rtf|csv|tsv|json|ya?ml|toml|bib|ris|tex|docx?|xlsx?|pptx?|odt|ods|odp|pages|numbers|key|epub|png|jpe?g|gif|webp|heic|tiff?|bmp|mp3|m4a|wav|aiff?|mp4|m4v|mov)$/i

// Files whose text is kept, so a change an agent makes to them on its own can be undone: Markdown, and
// other small text files a researcher keeps (references, LaTeX, data)
const TEXT_FILE = /\.(bib|ris|tex|txt|csv|tsv|json|ya?ml|toml)$/i
const keepsText = (rel: string, entry?: Entry) => isMarkdown(rel) || (TEXT_FILE.test(rel) && (entry?.size ?? Infinity) <= 1_000_000)

// The real path of a file, or of its deepest folder that exists followed by the rest; null for a link
// to nothing (writing would create its target, wherever that is)
function realOfDeepest(file: string): string | null {
  try {
    return realpathSync(file)
  } catch {
    if (lstatSync(file, { throwIfNoEntry: false })) return null
    const parent = path.dirname(file)
    if (parent === file) return file
    const real = realOfDeepest(parent)
    return real === null ? null : path.join(real, path.basename(file))
  }
}

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
