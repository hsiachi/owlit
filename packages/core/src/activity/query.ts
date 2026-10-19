import { isOwlit, isPerson, type ActivityAnswer, type ActivityItem, type ActivityLine, type ActivityQuery, type Change, type ChatActivity, type DocActivity, type JournalEntry, type ActorId, type OwlitId, type PaperActivity, type ReadStatus } from "@owlit/protocol"
import { readingOf, traceOf, type PaperReading } from "./reading.ts"

// What an agent may learn of what the user did (activity_read), summed from the journal. It answers with
// facts (how long, which pages, how often) and never with a score or a guess at what the user wants: the
// agent reads them, and a single action is left uninterpreted. Ranking for "top" happens here and is not
// shown.

const DAY = 86_400_000
// How far back each question looks when the agent doesn't say
const LOOK_BACK = { recent: 14 * DAY, top: 7 * DAY, log: 7 * DAY }
const LIMIT = { recent: 10, top: 10, log: 100 }
// The log never gives more lines than this
export const MAX_LINES = 200

export interface Names {
  paper: (id: string) => string | undefined
  chat: (id: string) => string | undefined
}

interface Context {
  now: number
  names: Names
  // Where a paper that changed id lives now
  alias?: (id: string) => string
  // Owlit's changes to docs, from the change log, oldest first
  changes?: Change[]
  // The paper's status now: Read is the one meaning of read (reading.ts › traceOf)
  status?: (id: string) => ReadStatus | undefined
}

// Owlit's change to a doc, read among the journal's lines
type Entry = JournalEntry | { kind: "owlit.changed"; actor: OwlitId; at: number; path: string; chatId?: string }

export function answerActivity(journal: JournalEntry[], query: ActivityQuery, ctx: Context): Omit<ActivityAnswer, "recording" | "cited"> {
  const alias = ctx.alias ?? ((id: string) => id)
  const entries = merge(journal, ctx.changes ?? [])
  // How far the user got with each paper is the whole history's, whatever stretch is asked about
  const whole = readingOf(journal, alias)
  const status = ctx.status ?? (() => undefined)
  const papers = { whole, status }
  if (query.mode === "of") {
    const of = (e: Entry) =>
      query.paper ? "paperId" in e && alias(e.paperId) === alias(query.paper) : query.doc ? "path" in e && e.path === query.doc : "chatId" in e && e.chatId === query.chat
    const mine = entries.filter(of)
    const lines = linesOf(mine, ctx.names, alias)
    return { items: itemsOf(mine, ctx.names, alias, papers), lines: lines.slice(-MAX_LINES), ...(lines.length > MAX_LINES ? { more: true } : {}) }
  }
  const since = query.since ?? ctx.now - LOOK_BACK[query.mode]
  const until = query.mode === "log" ? (query.until ?? Infinity) : Infinity
  const within = entries.filter((e) => e.at >= since && e.at <= until)
  const limit = Math.min(query.limit ?? LIMIT[query.mode], MAX_LINES)
  if (query.mode === "log") {
    const by = query.actor === "user" ? isPerson : query.actor === "agent" ? isOwlit : () => true
    const lines = linesOf(within, ctx.names, alias).filter((l) => by(l.actor))
    return { since, lines: lines.slice(-limit), ...(lines.length > limit ? { more: true } : {}) }
  }
  const items = itemsOf(within, ctx.names, alias, papers)
  const ranked = query.mode === "recent" ? items.sort((a, b) => b.last - a.last) : items.filter((i) => effort(i) > 0).sort((a, b) => effort(b) - effort(a))
  return { since, items: ranked.slice(0, limit), ...(ranked.length > limit ? { more: true } : {}) }
}

// The journal with Owlit's changes put in by time, each before journal lines of the same moment
function merge(journal: JournalEntry[], changes: Change[]): Entry[] {
  const owlit: Entry[] = changes.filter((c) => isOwlit(c.actor)).map((c) => ({ kind: "owlit.changed", actor: c.actor as OwlitId, at: c.at, path: c.target.path, ...(c.origin.chatId ? { chatId: c.origin.chatId } : {}) }))
  const out: Entry[] = []
  for (let i = 0, j = 0; i < journal.length || j < owlit.length; ) {
    if (j < owlit.length && (i >= journal.length || owlit[j].at <= journal[i].at)) out.push(owlit[j++])
    else out.push(journal[i++])
  }
  return out
}

// How much of the user's own time and hand went into a thing; only for ordering "top"
function effort(item: ActivityItem): number {
  if (item.kind === "paper") return item.pdfSeconds + item.digestSeconds + 120 * item.highlights + (item.noted ? 120 : 0) + (item.starred ? 60 : 0)
  if (item.kind === "doc") return 60 * item.edits + 5 * item.opens
  return 120 * item.sessions
}

// Agents' own records of owlit's state aren't the user's docs
const isOwlitState = (path: string) => path.split("/").some((part) => part.startsWith("."))

interface Papers {
  whole: Map<string, PaperReading>
  status: (id: string) => ReadStatus | undefined
}

function itemsOf(entries: Entry[], names: Names, alias: (id: string) => string, papers: Papers): ActivityItem[] {
  const items: ActivityItem[] = []
  const marks = new Map<string, Pick<PaperActivity, "starred" | "status" | "tags">>()
  for (const e of entries) {
    if (!isPerson(e.actor) || e.kind !== "paper.marked") continue
    const m = marks.get(alias(e.paperId)) ?? {}
    if (e.mark.what === "starred") m.starred = e.mark.to
    else if (e.mark.what === "status") m.status = e.mark.to
    else m.tags = e.mark.to
    marks.set(alias(e.paperId), m)
  }
  for (const p of readingOf(entries.filter((e): e is JournalEntry => e.kind !== "owlit.changed"), alias).values()) {
    items.push({
      kind: "paper",
      id: p.paperId,
      title: names.paper(p.paperId) ?? p.paperId,
      first: p.firstAt,
      last: p.lastAt,
      visits: p.visits,
      pdfSeconds: p.pdfSeconds,
      digestSeconds: p.digestSeconds,
      pages: p.pages,
      highlights: p.highlights,
      noted: p.noted,
      ...marks.get(p.paperId),
      trace: traceOf(papers.whole.get(p.paperId), papers.status(p.paperId)),
    })
  }
  const docs = new Map<string, DocActivity>()
  const chats = new Map<string, ChatActivity>()
  for (const e of entries) {
    if (e.kind === "doc.opened" || e.kind === "doc.edited" || (e.kind === "owlit.changed" && !isOwlitState(e.path))) {
      const d = docs.get(e.path) ?? { kind: "doc", path: e.path, first: e.at, last: e.at, opens: 0, edits: 0, agentEdits: 0 }
      d.first = Math.min(d.first, e.at)
      d.last = Math.max(d.last, e.at)
      if (e.kind === "doc.opened") d.opens++
      else if (e.kind === "doc.edited") d.edits++
      else d.agentEdits++
      docs.set(e.path, d)
    } else if (e.kind === "chat.ended") {
      const c = chats.get(e.chatId) ?? { kind: "chat", id: e.chatId, title: names.chat(e.chatId) ?? e.chatId, first: e.at, last: e.at, sessions: 0 }
      c.first = Math.min(c.first, e.at)
      c.last = Math.max(c.last, e.at)
      c.sessions++
      chats.set(e.chatId, c)
    }
  }
  return [...items, ...docs.values(), ...chats.values()]
}

// The journal in order, with each visit to a paper (opened … closed, and the reading time and pages
// between) as one line, and the same edit repeated as one line with a count
function linesOf(entries: Entry[], names: Names, alias: (id: string) => string): ActivityLine[] {
  const lines: ActivityLine[] = []
  const paper = (id: string) => ({ id: alias(id), title: names.paper(alias(id)) ?? alias(id) })
  const chat = (id: string) => ({ id, title: names.chat(id) ?? id })
  const visits = new Map<string, { at: number; actor: ActorId; seconds: number; digest: number; pages: Set<number> }>()
  const visit = (id: string, at: number, actor: ActorId) => {
    let v = visits.get(id)
    if (!v) visits.set(id, (v = { at, actor, seconds: 0, digest: 0, pages: new Set() }))
    return v
  }
  const endVisit = (id: string) => {
    const v = visits.get(id)
    if (!v) return
    visits.delete(id)
    const seconds = v.seconds + v.digest
    lines.push({
      at: v.at,
      actor: v.actor,
      // A visit is time spent, not a paper read: read is the end reached (reading.ts › readInFull)
      what: seconds ? "looked at" : "opened",
      paper: paper(id),
      ...(seconds ? { seconds } : {}),
      ...(v.pages.size ? { pages: [...v.pages].sort((a, b) => a - b) } : {}),
      ...(v.digest ? { detail: v.seconds ? `${v.digest} s of it on the digest` : "the digest only" } : {}),
    })
  }
  const push = (line: ActivityLine) => {
    const last = lines.at(-1)
    if (last && last.what === line.what && last.actor === line.actor && last.doc === line.doc && last.paper?.id === line.paper?.id && last.chat?.id === line.chat?.id && !line.detail) {
      last.times = (last.times ?? 1) + 1
      return
    }
    lines.push(line)
  }
  for (const e of entries) {
    if (e.kind === "owlit.changed") {
      if (!isOwlitState(e.path)) push({ at: e.at, actor: e.actor, what: "changed", doc: e.path, ...(e.chatId ? { chat: chat(e.chatId) } : {}) })
      continue
    }
    switch (e.kind) {
      case "paper.opened":
        endVisit(alias(e.paperId))
        visit(alias(e.paperId), e.at, e.actor)
        break
      case "paper.focus": {
        const v = visit(alias(e.paperId), e.at - e.seconds * 1000, e.actor)
        if (e.view === "pdf") v.seconds += e.seconds
        else v.digest += e.seconds
        break
      }
      case "paper.dwell":
        visit(alias(e.paperId), e.at, e.actor).pages.add(e.page)
        break
      case "paper.closed":
        // A closing with no opening before it (a journal from before openings were kept) is still a visit
        visit(alias(e.paperId), e.at, e.actor)
        endVisit(alias(e.paperId))
        break
      case "highlight.added":
        push({ at: e.at, actor: e.actor, what: "highlighted", paper: paper(e.paperId) })
        break
      case "note.edited":
        push({ at: e.at, actor: e.actor, what: "wrote in the note on", paper: paper(e.paperId) })
        break
      case "paper.marked": {
        const m = e.mark
        const what = m.what === "starred" ? (m.to ? "starred" : "unstarred") : m.what === "status" ? "set the status of" : "tagged"
        push({ at: e.at, actor: e.actor, what, paper: paper(e.paperId), ...(m.what === "status" ? { detail: m.to } : m.what === "tags" ? { detail: m.to.join(", ") || "no tags" } : {}) })
        break
      }
      case "doc.opened":
        push({ at: e.at, actor: e.actor, what: "opened", doc: e.path })
        break
      case "doc.edited":
        push({ at: e.at, actor: e.actor, what: "edited", doc: e.path })
        break
      case "chat.ended":
        push({ at: e.at, actor: e.actor, what: "wrote in the chat", chat: chat(e.chatId) })
        break
    }
  }
  for (const id of [...visits.keys()]) endVisit(id)
  return lines.sort((a, b) => a.at - b.at)
}
