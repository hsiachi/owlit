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
  type DocsListing,
  type DocStat,
  type WorkspaceFile,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { invalidParams, RpcFailure } from "../rpc/index.ts"

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

const notFound = (rel: string) => new RpcFailure(RpcErrorCode.NotFound, `There is no ${rel || "folder"} in the workspace.`, { path: rel })

// The workspace's files as Docs sees them. Every path in and out is workspace-relative and "/"-separated.
// What is read is written back as it was: no line endings touched, no final newline added.
export class Docs {
  private readonly root: string
  private readonly owlitDir: string
  private readonly host: Host
  // path → id, for as long as core runs, so a client's handle on a file survives renames core makes
  private ids = new Map<string, string>()
  private names: NamesFile | undefined
  // Changes run one at a time, so two writers never interleave on the same file
  private queue: Promise<unknown> = Promise.resolve()

  constructor(root: string, owlitDir: string, host: Host = {}) {
    this.root = root
    this.owlitDir = owlitDir
    this.host = host
  }

  async list(): Promise<DocsListing> {
    const files: WorkspaceFile[] = []
    const folders: string[] = []
    const follow = (await this.loadNames()).followFirstLine
    const walk = async (rel: string) => {
      const entries = await readdir(this.abs(rel), { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        const child = joinPath(rel, entry.name)
        if (!isDocsPath(child)) continue
        // Symlinked folders are not followed, so a link back up can't loop; a symlinked file is read through
        if (entry.isDirectory()) {
          folders.push(child)
          await walk(child)
          continue
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        const info = await stat(this.abs(child)).catch(() => null)
        if (!info?.isFile()) continue
        const file: WorkspaceFile = { ...this.statOf(child, info.mtimeMs, follow[child] ?? info.birthtimeMs) }
        if (isMarkdown(child)) file.content = await readFile(this.abs(child), "utf8")
        files.push(file)
      }
    }
    await walk("")
    // Forget ids of files that are gone
    const seen = new Set(files.map((f) => f.path))
    for (const p of this.ids.keys()) if (!seen.has(p)) this.ids.delete(p)
    return { files, folders }
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
      return { path: await this.moveEntry(rel, to) }
    })
  }

  delete(rel: string) {
    return this.serial(async () => {
      await this.entry(rel)
      const file = this.abs(rel)
      if (this.host.trash) await this.host.trash(file)
      else await this.moveToOwlitTrash(rel)
      for (const p of [...this.ids.keys()]) if (isWithin(p, rel)) this.ids.delete(p)
      await this.updateNames((f) => dropUnder(f, rel))
      return null
    })
  }

  createFolder(rel: string) {
    return this.serial(async () => {
      this.check(rel)
      const at = this.taken()(rel) ? uniquePath(parentPath(rel), baseName(rel), "", this.taken()) : rel
      await mkdir(this.abs(at), { recursive: true })
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
        this.ids.set(at, file.id)
        restored.push(await this.statAt(at))
      }
      return { files: restored, folders: made }
    })
  }

  async open(rel: string) {
    await this.entry(rel)
    if (!this.host.openPath) throw new RpcFailure(RpcErrorCode.InternalError, "owlit can't open files in other apps here.")
    await this.host.openPath(this.abs(rel))
    return null
  }

  // ---- inside ----

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
