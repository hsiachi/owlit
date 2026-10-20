import type { PaperIds, PaperKind } from "./library.ts"
// Two texts with the same words, whatever the spacing
export const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim()

// A thread: Owlit's report on a question the user asked, with the papers it rests on. Each paper is a row
// naming a Library paper by its id, with what the paper is and what it says about the question (one cell
// per column), and the groups Owlit put it in. Owlit's own record, in .owlit/threads/<id>/thread.json; a
// change of the user's lands in it as it is (ThreadEdit). A thread with only the question's own column
// reads as a list; adding a column makes it a table.

// How far Owlit read for an answer: the title only (the paper's record has no abstract), the abstract,
// or the full text (then it has a passage)
export type AnswerDepth = "title" | "abstract" | "full"

// How a paper bears on a sentence of the user's, in a column that compares papers with a doc
export type Relation = "supports" | "challenges" | "related"

// What a paper is, as a thread shows it: the Library's facts, which core lays over each row when it gives
// a thread out. Never kept in thread.json.
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
  // The paper's id in the Library
  id: string
  // What the paper is, one short line: its kind and material ("Field study, 12 participants")
  is?: string
  // By column id
  cells: Record<string, ThreadCell>
  // The groups it is in, by grouping column (group ids)
  in?: Record<string, string[]>
  // How it got here ("search: replay rating validity", "cited by Smith 2020")
  foundBy?: string
  addedAt: number
}

// A row as core gives it out: with its paper's facts from the Library
export interface ThreadRowRead extends ThreadRow {
  paper: ThreadPaper
}

// The column every thread has: the question itself
export const QUESTION_COLUMN = "q"
// The grouping a thread gets when Owlit first groups its papers without saying which way (Topic)
export const GROUPING_COLUMN = "topic"

export interface ThreadColumn {
  id: string
  // What is asked of every paper ("Method and sample"); for the question column, the question
  question: string
  // ask: a question answered for every paper; compare: the paper set against sentences from a doc;
  // grouping: a way of dividing the papers (分法), its groups here and each paper's in its row's `in`
  kind: "ask" | "compare" | "grouping"
  doc?: string
  sentences?: { id: string; text: string }[]
  // A grouping's groups, two levels at most
  groups?: ThreadGroup[]
  // Out of sight; a grouping is, until the user shows it (its groups' own rows already say it)
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

export interface ThreadAsked {
  // The question as the user typed it
  text: string
  chatId?: string
  docPath?: string
  at: number
}

export interface Thread {
  version: 3
  id: string
  title: string
  asked: ThreadAsked
  // Later questions Owlit answered by adding to this thread rather than starting another
  alsoAsked?: ThreadAsked[]
  // The workspace's top-level folder the work belongs to; "" for none
  project: string
  // Where Owlit looked ("Semantic Scholar", "OpenAlex", "ACM DL proceedings")
  sources: string[]
  // Owlit's report: Markdown, papers named as owlit://library/<id> links to rows
  report: string
  // Owlit's one line on the thread, for the list of threads
  one: string
  columns: ThreadColumn[]
  rows: ThreadRow[]
  // How the user last looked at the table: what it is grouped by ("grouping:<column>", "column:<column>"
  // for a comparison's sentences, or "none"). A preference of theirs, not a change: no dot, no history.
  view?: { groupBy?: string }
  createdAt: number
  updatedAt: number
}

// How many papers the user asks for when they start a thread from the Threads page: about ten, or as
// many as the question takes (a venue's proceedings)
export type ThreadSize = "few" | "many"

// A thread as core gives it out (threads.get, threads.changed): each row with its paper's facts
export type ThreadRead = Omit<Thread, "rows"> & { rows: ThreadRowRead[] }

// Items of a thread, as the change log names them (with column:<id>, alsoAsked and project)
export const itemId = {
  title: () => "title",
  report: () => "report",
  one: () => "one",
  cell: (paper: string, column: string) => `cell:${paper}:${column}`,
  row: (paper: string) => `row:${paper}`,
  group: (column: string, id: string) => `group:${column}:${id}`,
}

export const groupingsOf = (c: Pick<Thread, "columns">) => c.columns.filter((col) => col.kind === "grouping")

// One grouping as the thread holds it: its groups two levels deep at most (a group under one that is
// itself under another, or under one that isn't there, sits at the top), and the groups a paper is in, in
// the grouping's order. A paper in a subgroup is in its parent too, so it isn't also put in the parent
// itself.
export function groupingView(col: ThreadColumn) {
  const defs = new Map((col.groups ?? []).map((g) => [g.id, g]))
  const groups: ThreadGroup[] = (col.groups ?? []).map((g) => {
    const { parent, ...rest } = g
    const above = parent !== undefined && parent !== g.id ? defs.get(parent) : undefined
    return above && !above.parent ? { ...rest, parent } : rest
  })
  const parents = new Map(groups.map((g) => [g.id, g.parent]))
  const order = new Map(groups.map((g, i) => [g.id, i]))
  const of = (row: Pick<ThreadRow, "in">): string[] => {
    const ids = new Set((row.in?.[col.id] ?? []).filter((id) => order.has(id)))
    for (const id of [...ids]) {
      const parent = parents.get(id)
      if (parent) ids.delete(parent)
    }
    return [...ids].sort((a, b) => order.get(a)! - order.get(b)!)
  }
  return { groups, of }
}

// The thread with each grouping as groupingView reads it (its groups in the column, each paper's in its
// row's `in`)
export function shownThread<T extends Pick<Thread, "columns" | "rows">>(c: T): T {
  const views = groupingsOf(c).map((col) => ({ col, view: groupingView(col) }))
  if (!views.length) return c
  return {
    ...c,
    columns: c.columns.map((col) => (col.kind === "grouping" ? { ...col, groups: views.find((v) => v.col === col)!.view.groups } : col)),
    rows: c.rows.map((r) => {
      const { in: _in, ...rest } = r
      const placedIn = Object.fromEntries(views.map(({ col, view }) => [col.id, view.of(r)]).filter(([, ids]) => ids!.length))
      return { ...rest, ...(Object.keys(placedIn).length ? { in: placedIn } : {}) }
    }),
  }
}

// What the list of threads shows of one
export interface ThreadSummary {
  id: string
  title: string
  // The question as the user asked it
  question: string
  // Owlit's one line on it
  one: string
  project: string
  papers: number
  // Columns beyond the question's own
  columns: number
  createdAt: number
  updatedAt: number
}

export function summarize(c: Thread): ThreadSummary {
  return {
    id: c.id,
    title: c.title,
    question: c.asked.text,
    one: c.one,
    project: c.project,
    papers: c.rows.length,
    columns: c.columns.filter((col) => col.id !== QUESTION_COLUMN && !col.hidden).length,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
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
  // The whole report as Owlit means it now (Markdown)
  report?: string
  // Owlit's one line on the thread; the report's first sentence when a write gives a report without it
  one?: string
  // New columns to ask of every paper
  columns?: { id?: string; question: string }[]
  // Rows to add or update: only the cells given change
  rows?: ThreadRowWrite[]
  // The whole of one grouping as Owlit means it now: its groups, two levels at most
  groups?: ThreadGroup[]
  // The grouping column that groups and the rows' group(s) are for: the first grouping by default, and a
  // hidden Topic grouping when the thread has none yet
  grouping?: string
  // A new way of grouping the papers, by what it divides them by ("the chapters of the story"): the write's
  // groups and the rows' group(s) are for it. One the thread has already, by the same words, is that one.
  newGrouping?: string
  // Rows Owlit takes out
  removeRows?: string[]
  // One sentence on what this batch couldn't reach (a source that failed, an index that is incomplete,
  // papers without an abstract), kept with the batch in About
  note?: string
  chatId?: string
  // The agent's tool call making this write, when its engine names it
  toolCallId?: string
  docPath?: string
}

// One batch of Owlit's work on a thread, for About: what set it going, what it added or answered,
// the searches it made and what it said it couldn't reach. Worked out from the change log, less what was
// undone, and the searches and notes kept beside the thread.
export interface ThreadBatch {
  at: number
  // Its first gathering, Find more papers, reading in full, a column, a chat, or Owlit without saying
  // (threads from before batches were recorded)
  trigger: "gather" | "more" | "read" | "fill" | "chat" | "agent"
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
  is?: string
  cells?: Record<string, Omit<ThreadCell, "at">>
  // The groups Owlit puts it in, in the write's grouping, all of them ("" or []: none); group is one
  group?: string
  groups?: string[]
  foundBy?: string
}

// The user's own changes, from a window. Each lands in the thread's data, recorded in the change log
// item by item, so an undo puts back the item as it was.
export type ThreadEdit =
  | { op: "rename"; title: string }
  // A cell's or a group's name, by itemId
  | { op: "rewrite"; item: string; text: string }
  // A row, by itemId
  | { op: "remove"; item: string }
  // A paper into one more group of a grouping (in: true), or out of one (false); the others stay
  | { op: "place"; column: string; row: string; group: string; in: boolean }
  // Into a group, out of the one it was opened in (from; "" for none), or out of all of them when from is
  // absent; null: into none
  | { op: "move"; column: string; row: string; group: string | null; from?: string }
  // The group goes; its papers go to its parent (or to none), its subgroups to the top
  | { op: "ungroup"; column: string; group: string }
  // The group goes; its papers and subgroups go to the other
  | { op: "merge"; column: string; group: string; into: string }
  // A column out of sight, or back
  | { op: "hide"; column: string; hidden: boolean }
  | { op: "project"; project: string }
  // What the table is grouped by, remembered for the thread
  | { op: "view"; groupBy: string }

// Applies one of the user's changes to a thread in place, the same in core and in a window that has
// no core (the browser preview): the items it touched, or what stood in the way
export function applyThreadEdit(c: Thread, edit: ThreadEdit, now: number): { items: string[] } | { problem: "gone" | "empty" | "row" | "group" } {
  const grouping = (id: string) => c.columns.find((x) => x.id === id && x.kind === "grouping")
  switch (edit.op) {
    case "rename": {
      const text = edit.title.trim()
      if (!text) return { problem: "empty" }
      c.title = text
      return { items: [itemId.title()] }
    }
    case "rewrite": {
      const text = edit.text.trim()
      if (!text) return { problem: "empty" }
      const [kind, a, b] = edit.item.split(":")
      if (kind === "cell") {
        const cell = c.rows.find((r) => r.id === a)?.cells[b!]
        if (!cell) return { problem: "gone" }
        cell.text = text
        cell.at = now
      } else if (kind === "group") {
        const group = grouping(a!)?.groups?.find((g) => g.id === b)
        if (!group) return { problem: "gone" }
        group.name = text
      } else return { problem: "gone" }
      return { items: [edit.item] }
    }
    // The row's cells are items of their own: each goes with it, so an undo puts them back too
    case "remove": {
      const [kind, a] = edit.item.split(":")
      const at = kind === "row" ? c.rows.findIndex((r) => r.id === a) : -1
      if (at < 0) return { problem: "gone" }
      const [row] = c.rows.splice(at, 1)
      return { items: [edit.item, ...Object.keys(row!.cells).map((col) => itemId.cell(row!.id, col))] }
    }
    case "place":
    case "move": {
      const row = c.rows.find((r) => r.id === edit.row)
      const col = grouping(edit.column)
      if (!row) return { problem: "row" }
      if (!col) return { problem: "group" }
      const view = groupingView(col)
      if (edit.group && !view.groups.some((g) => g.id === edit.group)) return { problem: "group" }
      const ids = new Set(view.of(row))
      if (edit.op === "place") {
        if (edit.in) ids.add(edit.group)
        else ids.delete(edit.group)
      } else {
        for (const id of edit.from === undefined ? [...ids] : edit.from ? [edit.from] : []) ids.delete(id)
        if (edit.group) ids.add(edit.group)
      }
      putIn(row, col, [...ids])
      return { items: [itemId.row(row.id)] }
    }
    case "ungroup":
    case "merge": {
      const col = grouping(edit.column)
      const group = col?.groups?.find((g) => g.id === edit.group)
      const into = edit.op === "merge" ? col?.groups?.find((g) => g.id === edit.into) : undefined
      if (!col || !group || (edit.op === "merge" && (!into || into.id === group.id))) return { problem: "group" }
      // Where its papers go: the other group, or its parent; where its subgroups go: under the other
      // group's top-level group, or to the top
      const heir = edit.op === "merge" ? into!.id : group.parent
      const top = into && (into.parent && into.parent !== group.id ? into.parent : into.id)
      const items = [itemId.group(col.id, group.id)]
      col.groups = col.groups!.filter((g) => g.id !== group.id).map((g) => {
        if (g.parent !== group.id) return g
        items.push(itemId.group(col.id, g.id))
        const { parent: _parent, ...rest } = g
        return top && top !== g.id ? { ...rest, parent: top } : rest
      })
      for (const row of c.rows) {
        const ids = row.in?.[col.id]
        if (!ids?.includes(group.id)) continue
        putIn(row, col, [...ids.filter((id) => id !== group.id), ...(heir ? [heir] : [])])
        items.push(itemId.row(row.id))
      }
      return { items }
    }
    case "hide": {
      const column = c.columns.find((col) => col.id === edit.column)
      if (!column || column.id === QUESTION_COLUMN) return { problem: "gone" }
      column.hidden = edit.hidden
      return { items: [`column:${column.id}`] }
    }
    case "project":
      c.project = edit.project
      return { items: [] }
    case "view":
      c.view = { ...c.view, groupBy: edit.groupBy }
      return { items: [] }
  }
}

// A row's groups in one grouping, as groupingView would read them back
function putIn(row: ThreadRow, col: ThreadColumn, ids: string[]) {
  const placed = groupingView(col).of({ in: { [col.id]: [...new Set(ids)] } })
  if (placed.length) row.in = { ...row.in, [col.id]: placed }
  else if (row.in) {
    const { [col.id]: _gone, ...rest } = row.in
    if (Object.keys(rest).length) row.in = rest
    else delete row.in
  }
}
