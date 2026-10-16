import type { PaperIds, PaperKind } from "./library.ts"
// Two texts with the same words, whatever the spacing
export const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim()

// A thread: papers Owlit gathered for a question, what each says about it (one cell per column), the
// groups Owlit put them in, and a short memo of its reading. Owlit's own record, in
// .owlit/threads/<id>/thread.json. Owlit writes it without asking; what the user did to it
// (renamed it, rewrote a sentence or a cell, removed a row) is kept in `yours` and wins over every later
// write. A thread with only the question's own column reads as a short list; adding a column makes it
// a table.

// How far Owlit read for an answer: the abstract only, or the full text (then it has a passage)
export type AnswerDepth = "abstract" | "full"

// How a paper bears on a sentence of the user's, in a column that compares papers with a doc
export type Relation = "supports" | "challenges" | "related"

// The paper as it was found. A paper in the Library is shown as the Library has it (the user's corrections
// win); one that is not keeps this snapshot.
export interface ThreadPaper {
  title: string
  authors: string[]
  ids: PaperIds
  year?: number
  venue?: string
  abstract?: string
  tldr?: string
  kind?: PaperKind
  citationCount?: number
  // A free PDF is known
  openPdf?: boolean
}

export interface ThreadCell {
  text: string
  depth: AnswerDepth
  // The words the answer rests on, when Owlit read the full text; page is 1-based
  passage?: { quote: string; page: number }
  // Compare columns: how the paper bears on one of the user's sentences (absent: it doesn't speak to any)
  rel?: Relation
  sentence?: string
  at: number
}

export interface ThreadRow {
  // The paper's id, the one it has or would have in the Library
  id: string
  paper: ThreadPaper
  // By column id
  cells: Record<string, ThreadCell>
  group?: string
  // How it was found ("search: replay rating validity", "cited by doi-…")
  foundBy?: string
  addedAt: number
}

// The column every thread has: the question itself
export const QUESTION_COLUMN = "q"

export interface ThreadColumn {
  id: string
  // What is asked of every paper ("Method and sample"); for the question column, the question
  question: string
  // ask: a question answered for every paper; compare: the paper set against sentences from a doc
  kind: "ask" | "compare"
  doc?: string
  sentences?: { id: string; text: string }[]
  hidden?: boolean
}

export interface ThreadGroup {
  id: string
  name: string
  // One line on what the group holds
  one?: string
  // A group inside another
  parent?: string
}

// One sentence of Owlit's memo. Papers and groups are named in it as owlit:// links.
export interface MemoSentence {
  id: string
  text: string
}

export interface ThreadAsked {
  // The question as the user typed it
  text: string
  chatId?: string
  docPath?: string
  at: number
}

// What the user did. Items are named by itemId(): "title", "memo:<id>", "cell:<paper>:<column>",
// "row:<paper>", "group:<id>".
export interface ThreadYours {
  // Rewritten by the user: shown instead of Owlit's text, kept through every later write
  edits: Record<string, { text: string; at: number; was: string }>
  // Removed by the user: never shown, and never brought back by a later write
  removed: Record<string, { text: string; at: number }>
}

export interface Thread {
  version: 1
  id: string
  title: string
  asked: ThreadAsked
  // Later questions Owlit answered by adding to this thread rather than starting another
  alsoAsked?: ThreadAsked[]
  // The workspace's top-level folder the work belongs to; "" for none
  project: string
  // Where Owlit looked ("Semantic Scholar", "OpenAlex", "ACM DL proceedings")
  sources: string[]
  memo: MemoSentence[]
  columns: ThreadColumn[]
  rows: ThreadRow[]
  groups: ThreadGroup[]
  // Look for new papers now and then (off unless the user turns it on), and when Owlit last did
  watch: boolean
  checkedAt?: number
  // How many papers the user asked for when they started it from the Threads page: about ten, or
  // as many as the question takes (a venue's proceedings)
  size?: ThreadSize
  createdAt: number
  updatedAt: number
  // When Owlit last changed each item, and when the user last looked: an item changed after seenAt
  // carries Owlit's dot
  changedAt: Record<string, number>
  seenAt: number
  yours: ThreadYours
  // Kept separate from another thread: the rows as they were there (groups, every column) and the
  // question taken with them, so Undo can put them back
  splitFrom?: { id: string; rows: ThreadRow[]; asked?: ThreadAsked }
}

export type ThreadSize = "few" | "many"

// Work Owlit does on a thread in the background, as task kinds; the task's subject is the
// thread's id, "<id>:<column>" for filling a column, or "<id>:<paper>" for answering one row again
export const THREAD_RUNS = ["threads.gather", "threads.more", "threads.fill", "threads.read", "threads.check", "threads.reread"] as const
export type ThreadRun = (typeof THREAD_RUNS)[number]
export const threadOfSubject = (subject: string) => subject.split(":")[0]!

export const itemId = {
  title: () => "title",
  memo: (id: string) => `memo:${id}`,
  cell: (paper: string, column: string) => `cell:${paper}:${column}`,
  row: (paper: string) => `row:${paper}`,
  group: (id: string) => `group:${id}`,
}

// The thread as the user sees it: their rewrites in place of Owlit's text, what they removed gone
export function shownThread(c: Thread): Thread {
  const { edits, removed } = c.yours
  const text = (id: string, owlit: string) => edits[id]?.text ?? owlit
  return {
    ...c,
    title: text(itemId.title(), c.title),
    memo: c.memo.filter((s) => !removed[itemId.memo(s.id)]).map((s) => ({ ...s, text: text(itemId.memo(s.id), s.text) })),
    rows: c.rows
      .filter((r) => !removed[itemId.row(r.id)])
      .map((r) => ({
        ...r,
        cells: Object.fromEntries(Object.entries(r.cells).map(([col, cell]) => [col, { ...cell, text: text(itemId.cell(r.id, col), cell.text) }])),
      })),
    groups: c.groups.map((g) => ({ ...g, name: text(itemId.group(g.id), g.name) })),
  }
}

// What the list of threads shows of one
export interface ThreadSummary {
  id: string
  title: string
  project: string
  // Rows the user hasn't removed
  papers: number
  // Columns beyond the question's own
  columns: number
  createdAt: number
  updatedAt: number
  // Owlit changed something since the user last looked, or they haven't looked at it yet
  fresh: boolean
  watch: boolean
}

export function summarize(c: Thread): ThreadSummary {
  const shown = shownThread(c)
  return {
    id: c.id,
    title: shown.title,
    project: c.project,
    papers: shown.rows.length,
    columns: c.columns.filter((col) => col.id !== QUESTION_COLUMN && !col.hidden).length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    fresh: c.seenAt === 0 || Object.values(c.changedAt).some((at) => at > c.seenAt),
    watch: c.watch,
  }
}

// An agent's write: a new thread (no id), or more for an existing one. Rows are named by paper id;
// core fills in what each paper is from the search that found it or from the Library.
export interface ThreadWrite {
  id?: string
  // The question as the user asked it (kept with the thread, also when adding to one), and for a new
  // thread Owlit's neutral title for it
  asked?: string
  title?: string
  project?: string
  sources?: string[]
  // The whole memo as Owlit means it now; a sentence that keeps its id keeps its place in the history
  memo?: { id?: string; text: string }[]
  // New columns to ask of every paper
  columns?: { id?: string; question: string }[]
  // Rows to add or update: only the cells given change
  rows?: ThreadRowWrite[]
  // The whole grouping as Owlit means it now
  groups?: ThreadGroup[]
  // Rows Owlit takes out (the user's own removals are separate and stay)
  removeRows?: string[]
  why?: string
  // One sentence on what this batch couldn't reach (a source that failed, an index that is incomplete,
  // papers without an abstract), kept with the batch in About
  note?: string
  chatId?: string
  // The background run writing, as "<kind>:<task id>": its searches and writes are one batch
  run?: string
  docPath?: string
}

// One batch of Owlit's work on a thread, for About: what set it going, what it added or answered,
// the searches it made and what it said it couldn't reach. Worked out from the thread's history.
export interface ThreadBatch {
  at: number
  // Its first gathering, Find more papers, a watch check, reading in full, a column, a chat, or Owlit
  // without saying (threads from before batches were recorded)
  trigger: "gather" | "more" | "check" | "read" | "fill" | "chat" | "agent"
  chatId?: string
  // A later question in a chat that Owlit answered by adding here
  asked?: string
  added: number
  // Answers written for papers that were there already, and the questions they answer (not the
  // thread's own)
  answered: number
  columns: string[]
  searches: ThreadSearch[]
  notes: string[]
}

export interface ThreadSearch {
  // search: words in a source; references / cited_by / similar: following a paper (of, its title);
  // listing: a venue's or a journal's papers
  kind: "search" | "references" | "cited_by" | "similar" | "listing"
  query: string
  of?: string
  source: string
  found: number
  // Of what it found, how many became rows in this batch
  kept: number
}

export interface ThreadRowWrite {
  id: string
  cells?: Record<string, Omit<ThreadCell, "at">>
  group?: string
  foundBy?: string
  // Core's own callers may give the paper; agents name it by id and core looks it up
  paper?: ThreadPaper
}

// The user's own changes, from a window
export type ThreadEdit =
  | { op: "rename"; title: string }
  | { op: "rewrite"; item: string; text: string }
  // Drops the user's rewrite of an item: Owlit's text shows again
  | { op: "revert"; item: string }
  | { op: "remove"; item: string }
  | { op: "unremove"; item: string }
  | { op: "move"; row: string; group: string | null }
  | { op: "ungroup"; group: string }
  | { op: "merge"; group: string; into: string }
  | { op: "watch"; on: boolean }
  // A column out of sight, or back
  | { op: "hide"; column: string; hidden: boolean }
  | { op: "project"; project: string }
  | { op: "seen" }

// Owlit's own text for an item, before the user's rewrite
export function owlitText(c: Thread, item: string): string | undefined {
  if (item === itemId.title()) return c.title
  const [kind, a, b] = item.split(":")
  if (kind === "memo") return c.memo.find((s) => s.id === a)?.text
  if (kind === "cell") return c.rows.find((r) => r.id === a)?.cells[b!]?.text
  if (kind === "group") return c.groups.find((g) => g.id === a)?.name
  return undefined
}

// What a removed item was, for the record (and so the same words can be kept out)
function removedText(c: Thread, item: string): string | undefined {
  const [kind, a] = item.split(":")
  if (kind === "row") return c.rows.find((r) => r.id === a)?.paper.title
  return owlitText(c, item)
}

// Applies one of the user's changes to a thread in place, the same in core and in a window that has
// no core (the browser preview): the items it touched, or what stood in the way
export function applyThreadEdit(c: Thread, edit: ThreadEdit, now: number): { items: string[] } | { problem: "gone" | "empty" | "row" | "group" } {
  switch (edit.op) {
    case "rename":
    case "rewrite": {
      const item = edit.op === "rename" ? itemId.title() : edit.item
      const owlit = owlitText(c, item)
      if (owlit === undefined) return { problem: "gone" }
      const text = (edit.op === "rename" ? edit.title : edit.text).trim()
      if (!text) return { problem: "empty" }
      if (sameWords(text, owlit)) delete c.yours.edits[item]
      else c.yours.edits[item] = { text, at: now, was: owlit }
      return { items: [item] }
    }
    case "revert":
      delete c.yours.edits[edit.item]
      return { items: [edit.item] }
    case "remove": {
      const text = removedText(c, edit.item)
      if (text === undefined) return { problem: "gone" }
      c.yours.removed[edit.item] = { text, at: now }
      return { items: [edit.item] }
    }
    case "unremove":
      delete c.yours.removed[edit.item]
      return { items: [edit.item] }
    case "move": {
      const row = c.rows.find((r) => r.id === edit.row)
      if (!row) return { problem: "row" }
      if (edit.group && !c.groups.some((g) => g.id === edit.group)) return { problem: "group" }
      if (edit.group) row.group = edit.group
      else delete row.group
      return { items: [itemId.row(edit.row)] }
    }
    case "ungroup":
    case "merge": {
      const group = c.groups.find((g) => g.id === edit.group)
      if (!group || (edit.op === "merge" && !c.groups.some((g) => g.id === edit.into))) return { problem: "group" }
      const into = edit.op === "merge" ? edit.into : group.parent
      for (const row of c.rows) {
        if (row.group !== group.id) continue
        if (into) row.group = into
        else delete row.group
      }
      for (const g of c.groups) if (g.parent === group.id) g.parent = into
      c.groups = c.groups.filter((g) => g.id !== group.id)
      return { items: [itemId.group(group.id)] }
    }
    case "watch":
      c.watch = edit.on
      return { items: [] }
    case "hide": {
      const column = c.columns.find((col) => col.id === edit.column)
      if (!column || column.id === QUESTION_COLUMN) return { problem: "gone" }
      column.hidden = edit.hidden
      return { items: [`column:${column.id}`] }
    }
    case "project":
      c.project = edit.project
      return { items: [] }
    case "seen":
      // Covers every change so far, even one dated a moment ahead so that it got its dot
      c.seenAt = Math.max(now, ...Object.values(c.changedAt))
      return { items: [] }
  }
}
