import { isMarkdown, isProjectMark, parentPath, type Change, type DocComment, type JournalEntry, type Paper, type PersonId, type Project, type ProjectsSummary, type ProjectSummary } from "@owlit/protocol"
import { stat } from "node:fs/promises"
import { readJournal } from "../activity/reading.ts"
import { citationsIn } from "../library/wear.ts"

// What Home shows of each project, from the person's journal (.owlit/journal.jsonl) and the project's
// current drafts. Whether a project is live is counted in the person's own working sessions, never in days:
// a project edited three weeks ago is live when the person hasn't sat down to work since, and one edited
// yesterday goes quiet after a few sittings spent elsewhere.

// Two of the person's journal events further apart than this start a new working session: a coffee or a
// meeting stays inside one sitting, coming back after lunch is another. Reading time is settled into the
// journal every 30 seconds while a paper is in front, so a sitting spent reading never shows a gap this long.
export const SESSION_GAP_MS = 45 * 60_000
// A project is live while the person edited one of its docs in this many of their latest sessions: about
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
  // The person's edits, newest first
  const edits = mine.flatMap((e) => (e.kind === "doc.edited" ? [{ path: e.path, at: e.at }] : [])).sort((a, b) => b.at - a.at)
  const marked = new Set(projects.map((p) => p.path))
  const home = (rel: string) => {
    for (let p = parentPath(rel); p; p = parentPath(p)) if (marked.has(p)) return p
    return undefined
  }
  const unseen = await services.unseen()

  const summaries: ProjectSummary[] = []
  for (const project of projects) {
    const own = edits.filter((e) => home(e.path) === project.path)
    const done = project.status === "done"
    const last = own.find((e) => docs.has(e.path))
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
      live: !done && own.some((e) => e.at >= lately),
      ...(last ? { lastWorked: last } : newest ? { lastWorked: { path: newest.path, at: newest.modifiedAt, draft: true } } : {}),
      waits: await waitsOn(services, project),
      changed: changedDocs.size,
      ...(changedIn ? { changedIn } : {}),
    })
  }

  // The top folder of each doc edited lately that no mark covers: the unit a person would make a project
  const folders = new Map<string, { path: string; doc: string; lastWorked: number }>()
  for (const e of edits) {
    if (e.at < lately || !docs.has(e.path) || home(e.path)) continue
    const top = e.path.split("/")[0]!
    if (top === e.path || top.startsWith(".") || folders.has(top)) continue
    folders.set(top, { path: top, doc: e.path, lastWorked: e.at })
  }
  return { sessions: starts.length, projects: summaries, folders: [...folders.values()] }
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
