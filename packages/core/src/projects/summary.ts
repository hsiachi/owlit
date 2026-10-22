import { isMarkdown, isOwlit, isProjectMark, parentPath, type Change, type DocComment, type JournalEntry, type Paper, type PersonId, type Project, type ProjectsSummary, type ProjectSummary } from "@owlit/protocol"
import { stat } from "node:fs/promises"
import { readJournal } from "../activity/reading.ts"
import { citationsIn } from "../library/wear.ts"

// What Home shows of each project, from the person's journal (.owlit/journal.jsonl), Owlit's edits in the
// change log and the project's current drafts. Whether a project is live is counted in the person's own
// working sessions, never in days: a project worked on three weeks ago is live when the person hasn't sat
// down to work since, and one worked on yesterday goes quiet after a few sittings spent elsewhere. Work is
// more than typing: much of a paper gets written by asking Owlit in a chat to write or change it.

// Two of the person's journal events further apart than this start a new working session: a coffee or a
// meeting stays inside one sitting, coming back after lunch is another. Reading time is settled into the
// journal every 30 seconds while a paper is in front, so a sitting spent reading never shows a gap this long.
export const SESSION_GAP_MS = 45 * 60_000
// A project is live while the person worked on it in this many of their latest sessions: about
// a week of steady work, however long the person was away
export const LIVE_SESSIONS = 5

export interface SummaryServices {
  projects: () => Promise<Project[]>
  // Every docs file with its mtime (Docs.files)
  files: () => Promise<{ path: string; modifiedAt: number }[]>
  // The journal's entries in order, everyone's
  journal: () => Promise<JournalEntry[]>
  // A doc's comments
  comments: (rel: string) => Promise<DocComment[]>
  // A doc's text on disk; null when it can't be read
  read: (rel: string) => Promise<string | null>
  // How many of Owlit's standing changes to a doc the person hasn't had on screen, as the doc marks them
  // (changes.proposals); text: the doc as it is on disk
  proposals: (rel: string, text: string) => Promise<number>
  // A Library paper by any id it goes by; undefined when the Library has none
  paper: (id: string) => Promise<Pick<Paper, "id" | "pdf" | "pdfState"> | undefined>
  // The change log's entries the person hasn't seen (changes.unseen)
  unseen: () => Promise<Change[]>
  // The change log's entries on docs, in any order
  changes: () => Promise<Change[]>
  // Who started a chat: owlit (on its own, about a comment or a doc) or the person; null when there is
  // no such chat
  chatStartedBy: (chatId: string) => Promise<"owlit" | "person" | null>
  // The projects a chat is in (Projects.projectsOf) and the docs it touched (projects.ts touchedBy)
  chatWork: (chatId: string) => Promise<{ projects: Project[]; docs: string[] }>
}

// A bit of the person's work: a doc they edited, a doc Owlit edited at their asking in a chat, or a chat
// they wrote in, with the projects it was in and the docs it touched
interface Work {
  at: number
  // The doc worked on, for an edit
  path?: string
  by?: "owlit"
  // A chat's projects, by path
  projects?: string[]
  // A chat's docs
  docs?: string[]
}

// When each working session began, oldest first. times: the person's events, in any order.
export function sessionStarts(times: number[]): number[] {
  const starts: number[] = []
  let last = -Infinity
  for (const at of [...times].sort((a, b) => a - b)) {
    if (at - last > SESSION_GAP_MS) starts.push(at)
    last = at
  }
  return starts
}

export async function summarize(services: SummaryServices, me: PersonId): Promise<ProjectsSummary> {
  const [projects, files, journal] = await Promise.all([services.projects(), services.files(), services.journal()])
  const mine = journal.filter((e) => e.actor === me)
  const starts = sessionStarts(mine.map((e) => e.at))
  // Every edit since the first of the latest sessions; a journal with fewer sessions is lately whole
  const lately = starts.length > LIVE_SESSIONS ? starts[starts.length - LIVE_SESSIONS] : -Infinity
  const docs = new Set(files.filter((f) => isMarkdown(f.path) && !isProjectMark(f.path)).map((f) => f.path))
  const marked = new Set(projects.map((p) => p.path))
  const home = (rel: string) => {
    for (let p = parentPath(rel); p; p = parentPath(p)) if (marked.has(p)) return p
    return undefined
  }
  const [unseen, work] = await Promise.all([services.unseen(), workOf(services, mine, lately)])
  // Newest first
  const edits = work.filter((w): w is Work & { path: string } => w.path !== undefined)

  const summaries: ProjectSummary[] = []
  for (const project of projects) {
    const own = work.filter((w) => (w.path !== undefined ? home(w.path) === project.path : w.projects!.includes(project.path)))
    const done = project.status === "done"
    const last = edits.find((e) => home(e.path) === project.path && docs.has(e.path))
    const newest = project.currentDrafts[0]
    const changedDocs = new Map<string, number>()
    for (const c of unseen) {
      if (c.target.kind !== "doc" || !docs.has(c.target.path) || home(c.target.path) !== project.path) continue
      changedDocs.set(c.target.path, Math.max(changedDocs.get(c.target.path) ?? 0, c.until ?? c.at))
    }
    const changedIn = [...changedDocs].sort((a, b) => b[1] - a[1])[0]?.[0]
    summaries.push({
      path: project.path,
      name: project.name,
      ...(project.status ? { status: project.status } : {}),
      ...(project.due ? { due: project.due } : {}),
      live: !done && own.some((w) => w.at >= lately),
      ...(last ? { lastWorked: { path: last.path, at: last.at, ...(last.by ? { by: last.by } : {}) } } : newest ? { lastWorked: { path: newest.path, at: newest.modifiedAt, draft: true } } : {}),
      ...(own.length ? { workedAt: own[0]!.at } : {}),
      waits: await waitsOn(services, project),
      changed: changedDocs.size,
      ...(changedIn ? { changedIn } : {}),
    })
  }

  // The top folder of each doc worked on lately that no mark covers: the unit a person would make a
  // project. Work comes newest first, so each folder keeps its newest doc.
  const folders = new Map<string, { path: string; doc: string; lastWorked: number }>()
  for (const w of work) {
    if (w.at < lately) break
    for (const rel of w.path !== undefined ? [w.path] : w.docs!) {
      if (!docs.has(rel) || home(rel)) continue
      const top = rel.split("/")[0]!
      if (top === rel || top.startsWith(".") || folders.has(top)) continue
      folders.set(top, { path: top, doc: rel, lastWorked: w.at })
    }
  }
  return { sessions: starts.length, projects: summaries, folders: [...folders.values()] }
}

// The person's work, newest first: their own edits (a mark's never: it says what a folder is, and making
// one is no work on the project); Owlit's edits to docs in chats the person started
// (one owlit started on its own, about a comment or a doc, is Owlit's work, not the person's asking); and
// the chats they wrote in since lately began. A chat's projects are asked only for those, each once:
// projectsOf reads the chat and its changes.
async function workOf(services: SummaryServices, mine: JournalEntry[], lately: number): Promise<Work[]> {
  const work: Work[] = []
  const chatIds = new Set<string>()
  for (const e of mine) {
    if (e.kind === "doc.edited") {
      if (!isProjectMark(e.path)) work.push({ at: e.at, path: e.path })
    }
    // A chat.ended is journaled only for a chat the person wrote in
    else if (e.kind === "chat.ended" && e.at >= lately) chatIds.add(e.chatId)
  }
  const chats = new Map(await Promise.all([...chatIds].map(async (id) => [id, await services.chatWork(id).catch(() => ({ projects: [], docs: [] }))] as const)))
  for (const e of mine) {
    if (e.kind !== "chat.ended" || e.at < lately) continue
    const chat = chats.get(e.chatId)!
    work.push({ at: e.at, projects: chat.projects.map((p) => p.path), docs: chat.docs })
  }

  const startedBy = new Map<string, Promise<"owlit" | "person" | null>>()
  const askedBy = (id: string) => {
    let by = startedBy.get(id)
    if (!by) startedBy.set(id, (by = services.chatStartedBy(id).catch(() => null)))
    return by
  }
  for (const c of await services.changes()) {
    const chatId = c.origin.chatId
    if (!isOwlit(c.actor) || c.target.kind !== "doc" || !chatId || c.undoes || isProjectMark(c.target.path)) continue
    if ((await askedBy(chatId)) === "person") work.push({ at: c.until ?? c.at, path: c.target.path, by: "owlit" })
  }
  return work.sort((a, b) => b.at - a.at)
}

async function waitsOn(services: SummaryServices, project: Project): Promise<ProjectSummary["waits"]> {
  const waits: ProjectSummary["waits"] = { comments: 0, proposals: 0, noPdf: 0 }
  const cited = new Set<string>()
  for (const draft of project.currentDrafts) {
    const open = (await services.comments(draft.path)).filter((c) => !c.resolvedAt && !c.foldedAt).length
    if (open && !waits.commentsIn) waits.commentsIn = draft.path
    waits.comments += open
    const text = await services.read(draft.path)
    if (text === null) continue
    const proposals = await services.proposals(draft.path, text)
    if (proposals && !waits.proposalsIn) waits.proposalsIn = draft.path
    waits.proposals += proposals
    for (const c of citationsIn(text)) cited.add(c.paperId)
  }
  const counted = new Set<string>()
  for (const id of cited) {
    const paper = await services.paper(id)
    if (!paper || counted.has(paper.id)) continue
    counted.add(paper.id)
    // Only a paper owlit gave up on: one it is still looking for may yet come
    if (!paper.pdf && paper.pdfState?.state === "no-pdf") waits.noPdf++
  }
  return waits
}

// The journal file's entries, read again only when the file changed: Home asks for the summary after
// every change in the workspace, and a journal grows to many thousands of lines
export function journalOf(file: string): () => Promise<JournalEntry[]> {
  let kept: { stamp: string; entries: JournalEntry[] } | undefined
  return async () => {
    const info = await stat(file).catch(() => null)
    if (!info) return []
    const stamp = `${info.mtimeMs}:${info.size}`
    if (kept?.stamp !== stamp) kept = { stamp, entries: await readJournal(file).catch(() => []) }
    return kept.entries
  }
}
