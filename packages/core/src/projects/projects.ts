import { baseName, frontmatterEnd, isMarkdown, isProjectMark, isWithin, paperUri, parentPath, parseOwlitUri, projectKey, threadUri, type Change, type Chat, type CurrentDraft, type MemoryLine, type Project, type ProjectStatus } from "@owlit/protocol"
import path from "node:path"
import { Serial } from "../util.ts"

// Projects are computed, never stored: a folder holding a project.md (any case) is one, at any depth, and a
// thing's project is the nearest marked folder above its path, asked each time. Nested marks make nested
// projects; the nearest is where a thing is, its parents are the lineage.

export interface ProjectsServices {
  // Every docs file with its mtime (Docs.files)
  files: () => Promise<{ path: string; modifiedAt: number }[]>
  // A file's text; null when it can't be read
  read: (rel: string) => Promise<string | null>
  // A chat with its messages; null when there is none
  chat: (id: string) => Promise<Chat | null>
  // The change log's entries made from a chat (origin.chatId)
  changesOf: (chatId: string) => Promise<Change[]>
  // A thread's project field; undefined when there is no such thread
  thread: (id: string) => Promise<{ project: string } | undefined>
  // The docs whose text links to an owlit:// address (the search index's links, papers under any id)
  docsLinking: (uri: string) => Promise<string[]>
  // The Library's id for a paper named by any id it goes by
  canonical: (id: string) => Promise<string | undefined>
  // What list() answers changed since refresh() last looked
  changed?: (projects: Project[]) => void
}

// What projectsOf answers for. A memory line is in the projects of the chat it came from.
export type ProjectThing =
  | { kind: "doc"; path: string }
  | { kind: "chat"; id: string }
  | { kind: "thread"; id: string }
  | { kind: "paper"; id: string }
  | { kind: "memory"; line: Pick<MemoryLine, "chatId"> }

interface MarkFields {
  name?: string
  status?: ProjectStatus
  due?: string
  current?: string
}

export class Projects {
  private readonly services: ProjectsServices
  // Each mark's fields by its path, with the mtime they were read at: marks are few and small, but list()
  // runs on every change to the workspace's docs
  private marks = new Map<string, { modifiedAt: number; fields: MarkFields }>()
  // What refresh() last saw, as JSON; undefined until its first look
  private told: string | undefined
  private readonly turn = new Serial()

  constructor(services: ProjectsServices) {
    this.services = services
  }

  // Every project, by path
  async list(): Promise<Project[]> {
    const files = await this.services.files()
    const marked = new Map<string, { mark: string; fields: MarkFields }>()
    for (const file of files.filter((f) => isProjectMark(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1))) {
      const folder = parentPath(file.path)
      // The workspace itself is no project: a doc at its root is in none, whatever a project.md there says
      if (!folder || marked.has(folder)) continue
      marked.set(folder, { mark: file.path, fields: await this.fieldsOf(file) })
    }
    for (const rel of this.marks.keys()) if (!marked.has(parentPath(rel)) || marked.get(parentPath(rel))!.mark !== rel) this.marks.delete(rel)

    const drafts = new Map<string, Map<string, CurrentDraft>>()
    for (const file of files) {
      if (!isMarkdown(file.path) || isProjectMark(file.path)) continue
      const home = nearestIn(marked, file.path)
      if (!home) continue
      // A doc filed under an Archive folder of its project is kept, not worked on
      if (file.path.slice(home.length + 1).split("/").slice(0, -1).some((s) => s.toLowerCase() === "archive")) continue
      const kind = draftKind(file.path)
      const kinds = drafts.get(home) ?? new Map<string, CurrentDraft>()
      drafts.set(home, kinds)
      const was = kinds.get(kind)
      if (!was || newer(file, was)) kinds.set(kind, { kind, path: file.path, modifiedAt: file.modifiedAt })
    }

    const byPath = new Map(files.map((f) => [f.path, f]))
    const folders = [...marked].sort(([a], [b]) => (a < b ? -1 : 1))
    return folders.map(([folder, { mark, fields }]) => {
      const kinds = new Map(drafts.get(folder))
      const current = fields.current !== undefined ? currentPath(folder, fields.current) : undefined
      const named = current !== undefined ? byPath.get(current) : undefined
      if (named) kinds.set(draftKind(named.path), { kind: draftKind(named.path), path: named.path, modifiedAt: named.modifiedAt, byMark: true })
      const parents: string[] = []
      for (let p = parentPath(folder); p; p = parentPath(p)) if (marked.has(p)) parents.push(p)
      return {
        path: folder,
        mark,
        name: fields.name || baseName(folder),
        ...(fields.status ? { status: fields.status } : {}),
        ...(fields.due ? { due: fields.due } : {}),
        ...(current !== undefined ? { current } : {}),
        parents,
        currentDrafts: [...kinds.values()].sort((a, b) => (newer(a, b) ? -1 : 1)),
      }
    })
  }

  // Looks again and tells `changed` when list() answers differently from the last look. The first look
  // only sets what later ones compare with: core takes it once the workspace's watcher runs.
  refresh(): Promise<void> {
    return this.turn.run(async () => {
      const projects = await this.list()
      const now = JSON.stringify(projects)
      const first = this.told === undefined
      if (now === this.told) return
      this.told = now
      if (!first) this.services.changed?.(projects)
    })
  }

  // The nearest marked folder at or above a workspace path; null for a path in no project
  async projectOf(rel: string): Promise<Project | null> {
    return nearestProject(byPathOf(await this.list()), rel)
  }

  // The projects a thing belongs to, nearest marks only (each one's lineage is in its parents), each once,
  // in the order found:
  // - a doc: its project.
  // - a chat: first the project the person put it in, while that folder is still marked; then the
  //   projects of the docs it touched (named in its messages' mentions, context and quoted selections,
  //   the doc or comment a chat owlit started is about, the docs and comments its turns changed by the
  //   change log, written ones among them) and of the threads it touched (named the same ways, or written
  //   by its turns). A chat that isn't there is in none.
  // - a thread: the marked folder its project field names (a value that is no marked folder's path counts
  //   for nothing), and the projects of the docs that link to it.
  // - a paper: the projects of the docs that link to it, under any id it goes by.
  // - a memory line: its chat's.
  async projectsOf(thing: ProjectThing): Promise<Project[]> {
    const byPath = byPathOf(await this.list())
    const found = new Map<string, Project>()
    const add = (project: Project | null | undefined) => {
      if (project) found.set(project.path, project)
    }
    const addDoc = (rel: string) => add(nearestProject(byPath, rel))
    const addMarked = (field: string | undefined) => {
      const key = projectKey(field)
      if (key) add([...byPath.values()].find((p) => projectKey(p.path) === key))
    }
    const addThread = async (id: string) => {
      addMarked((await this.services.thread(id))?.project)
      for (const rel of await this.services.docsLinking(threadUri(id))) addDoc(rel)
    }
    const addChat = async (id: string) => {
      const chat = await this.services.chat(id)
      if (!chat) return
      addMarked(chat.project)
      const { docs, threads } = touchedBy(chat, await this.services.changesOf(id))
      for (const rel of docs) addDoc(rel)
      for (const thread of threads) await addThread(thread)
    }
    if (thing.kind === "doc") addDoc(thing.path)
    else if (thing.kind === "chat") await addChat(thing.id)
    else if (thing.kind === "thread") await addThread(thing.id)
    else if (thing.kind === "paper") {
      const id = (await this.services.canonical(thing.id)) ?? thing.id
      for (const rel of await this.services.docsLinking(paperUri(id))) addDoc(rel)
    } else if (thing.line.chatId) await addChat(thing.line.chatId)
    return [...found.values()]
  }

  private async fieldsOf(file: { path: string; modifiedAt: number }) {
    const known = this.marks.get(file.path)
    if (known?.modifiedAt === file.modifiedAt) return known.fields
    const fields = parseMark((await this.services.read(file.path)) ?? "")
    this.marks.set(file.path, { modifiedAt: file.modifiedAt, fields })
    return fields
  }
}

// The docs and threads a chat touched, in the order its messages and then its changes name them. Files
// attached to a message are copies in the chat's own folder (.owlit/chats/), never a doc of a project.
export function touchedBy(chat: Chat, changes: Change[]): { docs: string[]; threads: string[] } {
  const docs = new Set<string>()
  const threads = new Set<string>()
  const named = (uri: string) => {
    const u = parseOwlitUri(uri)
    if (u?.kind === "doc") docs.add(u.path)
    else if (u?.kind === "thread") threads.add(u.id)
  }
  if (chat.about?.kind === "doc") docs.add(chat.about.id)
  // A comment is about as <doc path>#<comment id>
  else if (chat.about?.kind === "comment") docs.add(chat.about.id.slice(0, chat.about.id.lastIndexOf("#")))
  else if (chat.about?.kind === "thread") threads.add(chat.about.id)
  for (const m of chat.messages) {
    // context: what was on screen when asking from beside a page, the doc the chat is docked by
    for (const x of [...(m.mentions ?? []), ...(m.context ?? []), ...(m.selection ? [m.selection.source] : [])]) named(x.uri)
  }
  for (const c of changes) {
    if (c.target.kind === "doc" || c.target.kind === "comment") docs.add(c.target.path)
    else if (c.target.kind === "thread") threads.add(c.target.path)
  }
  docs.delete("")
  return { docs: [...docs], threads: [...threads] }
}

// The mark's head, read from the top: its front matter's status:, due: and current: lines, then the run
// of lines that are the "# " heading (the name) or one of those lines, blank lines among them skipped. The
// first other line ends the head, so the mark's own notes below can mention a status without setting it.
export function parseMark(text: string): MarkFields {
  const fields: MarkFields = {}
  const field = (line: string) => {
    const m = /^(status|due|current)\s*:\s*(.*)$/i.exec(line)
    if (!m) return false
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === "status") {
      const status = value.toLowerCase()
      if (status === "active" || status === "done") fields.status = status
    } else if (key === "due") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) fields.due = value
    } else {
      // Written as `path` or <path> as often as bare
      const rel = value.replace(/^[`<]+|[`>]+$/g, "").trim()
      if (rel) fields.current = rel
    }
    return true
  }
  const end = frontmatterEnd(text)
  for (const line of text.slice(0, end).split(/\r?\n/)) field(line.trim())
  for (const raw of text.slice(end).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#\s+(.*?)(?:\s+#+)?$/.exec(line)
    if (heading && fields.name === undefined) {
      fields.name = heading[1].trim()
      continue
    }
    if (!field(line)) break
  }
  return fields
}

// A version in a doc's name: v2, v3.1, set off by a space, -, _ or brackets ("Story-v2-Dataset",
// "Paper (v3)", "notes_v10"); a v inside a word ("Inventory") is none
const VERSION = /(?:^|[\s_\-(（])v\d+(?:\.\d+)*(?=$|[\s_\-)）.])/i

// The kind of doc a path is, for current drafts: its name without the extension, cut before the first
// version and without what follows it, so 研究故事-v2-Dataset.md and 研究故事-v3-委托提醒.md are one kind,
// 研究故事. A name that starts with its version is its own kind.
export function draftKind(rel: string): string {
  const name = baseName(rel)
  const stem = isMarkdown(name) ? name.slice(0, -3) : name.replace(/(.)\.[^.]*$/, "$1")
  const m = VERSION.exec(stem)
  const kind = m ? stem.slice(0, m.index).replace(/[\s_\-(（]+$/, "") : stem
  return kind || stem
}

// The mark's current: line as a workspace path: written relative to the project's folder, so the line
// stays right when the folder moves; undefined when it leads out of the folder
function currentPath(folder: string, written: string): string | undefined {
  const rel = path.posix.normalize(path.posix.join(folder, written.replace(/^\/+/, "")))
  return rel !== folder && isWithin(rel, folder) ? rel : undefined
}

// The nearest key of `marked` at or above rel
function nearestIn(marked: Map<string, unknown>, rel: string): string | undefined {
  for (let p = rel.replace(/^\.\/|\/+$/g, ""); p; p = parentPath(p)) if (marked.has(p)) return p
  return undefined
}

const nearestProject = (byPath: Map<string, Project>, rel: string) => {
  const at = nearestIn(byPath, rel)
  return at === undefined ? null : byPath.get(at)!
}

const byPathOf = (projects: Project[]) => new Map(projects.map((p) => [p.path, p]))

// Newer by mtime; the same mtime goes by path, so the answer never depends on the listing's order
const newer = (a: { path: string; modifiedAt: number }, b: { path: string; modifiedAt: number }) => a.modifiedAt > b.modifiedAt || (a.modifiedAt === b.modifiedAt && a.path < b.path)
