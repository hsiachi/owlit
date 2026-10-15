import type { ActivityAnswer, ActivityItem, ActivityLine, ActivityQuery, ChatActivity, DocActivity, JournalEntry, PaperActivity } from "@owlit/protocol"
import { readingOf } from "./reading.ts"

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
}

export function answerActivity(entries: JournalEntry[], query: ActivityQuery, ctx: Context): Omit<ActivityAnswer, "recording" | "cited"> {
  const alias = ctx.alias ?? ((id: string) => id)
  if (query.mode === "of") {
    const of = (e: JournalEntry) =>
      query.paper ? "paperId" in e && alias(e.paperId) === alias(query.paper) : query.doc ? "path" in e && e.path === query.doc : "chatId" in e && e.chatId === query.chat
    const mine = entries.filter(of)
    const lines = linesOf(mine, ctx.names, alias)
    return { items: itemsOf(mine, ctx.names, alias), lines: lines.slice(-MAX_LINES), ...(lines.length > MAX_LINES ? { more: true } : {}) }
  }
  const since = query.since ?? ctx.now - LOOK_BACK[query.mode]
  const until = query.mode === "log" ? (query.until ?? Infinity) : Infinity
  const within = entries.filter((e) => e.at >= since && e.at <= until)
  const limit = Math.min(query.limit ?? LIMIT[query.mode], MAX_LINES)
  if (query.mode === "log") {
    const lines = linesOf(within, ctx.names, alias).filter((l) => !query.actor || l.actor === query.actor)
    return { since, lines: lines.slice(-limit), ...(lines.length > limit ? { more: true } : {}) }
  }
  const items = itemsOf(within, ctx.names, alias)
  const ranked = query.mode === "recent" ? items.sort((a, b) => b.last - a.last) : items.filter((i) => effort(i) > 0).sort((a, b) => effort(b) - effort(a))
  return { since, items: ranked.slice(0, limit), ...(ranked.length > limit ? { more: true } : {}) }
}

// How much of the user's own time and hand went into a thing; only for ordering "top"
function effort(item: ActivityItem): number {
  if (item.kind === "paper") return item.pdfSeconds + item.digestSeconds + 120 * item.highlights + (item.noted ? 120 : 0) + (item.starred ? 60 : 0)
  if (item.kind === "doc") return 60 * item.edits + 5 * item.opens
  return 120 * item.sessions
}

// Agents' own records of owlit's state (threads, versions) aren't the user's docs
const isOwlitState = (path: string) => path.split("/").some((part) => part.startsWith("."))

function itemsOf(entries: JournalEntry[], names: Names, alias: (id: string) => string): ActivityItem[] {
  const items: ActivityItem[] = []
  const marks = new Map<string, Pick<PaperActivity, "starred" | "status" | "tags">>()
  for (const e of entries) {
    if (e.actor !== "user" || e.kind !== "paper.marked") continue
    const m = marks.get(alias(e.paperId)) ?? {}
    if (e.mark.what === "starred") m.starred = e.mark.to
    else if (e.mark.what === "status") m.status = e.mark.to
    else m.tags = e.mark.to
    marks.set(alias(e.paperId), m)
  }
  for (const p of readingOf(entries, alias).values()) {
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
      read: p.read,
    })
  }
  const docs = new Map<string, DocActivity>()
  const chats = new Map<string, ChatActivity>()
  for (const e of entries) {
    if (e.kind === "doc.opened" || e.kind === "doc.edited" || (e.kind === "agent.wrote" && !isOwlitState(e.path))) {
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
function linesOf(entries: JournalEntry[], names: Names, alias: (id: string) => string): ActivityLine[] {
  const lines: ActivityLine[] = []
  const paper = (id: string) => ({ id: alias(id), title: names.paper(alias(id)) ?? alias(id) })
  const chat = (id: string) => ({ id, title: names.chat(id) ?? id })
  const visits = new Map<string, { at: number; seconds: number; digest: number; pages: Set<number> }>()
  const visit = (id: string, at: number) => {
    let v = visits.get(id)
    if (!v) visits.set(id, (v = { at, seconds: 0, digest: 0, pages: new Set() }))
    return v
  }
  const endVisit = (id: string) => {
    const v = visits.get(id)
    if (!v) return
    visits.delete(id)
    const seconds = v.seconds + v.digest
    lines.push({
      at: v.at,
      actor: "user",
      what: seconds ? "read" : "opened",
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
    if (e.actor === "agent") {
      if (!isOwlitState(e.path)) push({ at: e.at, actor: "agent", what: "changed", doc: e.path, ...(e.chatId ? { chat: chat(e.chatId) } : {}) })
      continue
    }
    switch (e.kind) {
      case "paper.opened":
        endVisit(alias(e.paperId))
        visit(alias(e.paperId), e.at)
        break
      case "paper.focus": {
        const v = visit(alias(e.paperId), e.at - e.seconds * 1000)
        if (e.view === "pdf") v.seconds += e.seconds
        else v.digest += e.seconds
        break
      }
      case "paper.dwell":
        visit(alias(e.paperId), e.at).pages.add(e.page)
        break
      case "paper.closed":
        // A closing with no opening before it (a journal from before openings were kept) is still a visit
        visit(alias(e.paperId), e.at)
        endVisit(alias(e.paperId))
        break
      case "highlight.added":
        push({ at: e.at, actor: "user", what: "highlighted", paper: paper(e.paperId) })
        break
      case "note.edited":
        push({ at: e.at, actor: "user", what: "wrote in the note on", paper: paper(e.paperId) })
        break
      case "paper.marked": {
        const m = e.mark
        const what = m.what === "starred" ? (m.to ? "starred" : "unstarred") : m.what === "status" ? "set the status of" : "tagged"
        push({ at: e.at, actor: "user", what, paper: paper(e.paperId), ...(m.what === "status" ? { detail: m.to } : m.what === "tags" ? { detail: m.to.join(", ") || "no tags" } : {}) })
        break
      }
      case "doc.opened":
        push({ at: e.at, actor: "user", what: "opened", doc: e.path })
        break
      case "doc.edited":
        push({ at: e.at, actor: "user", what: "edited", doc: e.path })
        break
      case "chat.ended":
        push({ at: e.at, actor: "user", what: "wrote in the chat", chat: chat(e.chatId) })
        break
    }
  }
  for (const id of [...visits.keys()]) endVisit(id)
  return lines.sort((a, b) => a.at - b.at)
}
