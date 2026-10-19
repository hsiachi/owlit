import type { PaperIds, PaperKind } from "./library.ts"
// Two texts with the same words, whatever the spacing
export const sameWords = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim()

// A thread: papers Owlit gathered for a question, what each says about it (one cell per column), the
// groups Owlit put them in, and a short memo of its reading. Owlit's own record, in
// .owlit/threads/<id>/thread.json. Owlit writes it without asking; what the user did to it
// (renamed it, rewrote a sentence or a cell, removed a row) is kept in `overrides` and wins over every later
// write. A thread with only the question's own column reads as a short list; adding a column makes it
// a table.

// How far Owlit read for an answer: the title only (the paper's record has no abstract), the abstract,
// or the full text (then it has a passage)
export type AnswerDepth = "title" | "abstract" | "full"

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
  // The groups Owlit put it in, by grouping column (group ids). The user's changes are in overrides.placed.
  in?: Record<string, string[]>
  // How it was found ("search: replay rating validity", "cited by doi-…")
  foundBy?: string
  addedAt: number
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
// "row:<paper>", "group:<column>:<id>".
export interface ThreadOverrides {
  // Rewritten by the user: shown instead of Owlit's text, kept through every later write
  edits: Record<string, { text: string; at: number; was: string }>
  // Removed by the user: never shown, and never brought back by a later write. A group removed is one
  // they ungrouped: its papers leave it (for its parent, when it has one).
  removed: Record<string, { text: string; at: number }>
  // Papers the user put in a group (in: true) or took out of one (false), by placedKey(): one paper in one
  // group each, so what they didn't touch stays Owlit's to change
  placed: Record<string, { in: boolean; at: number }>
  // Groups the user merged into another, by "<column>:<group>": a paper Owlit puts in one later goes in the
  // other
  merged: Record<string, string>
  // How the user last looked at the table: what it is grouped by ("grouping:<column>", "column:<column>"
  // for a comparison's sentences, or "none"). A preference of theirs, not a change: no dot, no history.
  view?: { groupBy?: string }
}

export interface Thread {
  version: 2
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
  // How many papers the user asked for when they started it from the Threads page: about ten, or
  // as many as the question takes (a venue's proceedings)
  size?: ThreadSize
  createdAt: number
  updatedAt: number
  overrides: ThreadOverrides
  // Kept separate from another thread: the rows as they were there (groups, every column) and the
  // question taken with them, so Undo can put them back
  splitFrom?: {
    id: string
    rows: ThreadRow[]
    asked?: ThreadAsked
    // Made from a group: the group, gone from the other thread until Undo, and the rows that stayed
    // there too because they were in other groups as well
    group?: { column: string; id: string }
    copied?: string[]
  }
}

export type ThreadSize = "few" | "many"

export const itemId = {
  title: () => "title",
  memo: (id: string) => `memo:${id}`,
  cell: (paper: string, column: string) => `cell:${paper}:${column}`,
  row: (paper: string) => `row:${paper}`,
  group: (column: string, id: string) => `group:${column}:${id}`,
}

// One paper in one group of a grouping, as overrides.placed keys it (paper ids have no colon)
export const placedKey = (column: string, paper: string, group: string) => `${column}:${paper}:${group}`

export const groupingsOf = (c: Pick<Thread, "columns">) => c.columns.filter((col) => col.kind === "grouping")

// One grouping as the user sees it: Owlit's groups with what the user did laid over them. A group they
// merged sends its papers to the one it went into, one they ungrouped to its parent (or to none); a group
// sits under a top-level group whatever was merged where, so there are two levels at most; and a paper is
// in what Owlit put it in, then what the user put it in or took it out of, latest last. A paper in a
// subgroup is in its parent too, so it isn't also put in the parent itself.
export function groupingView(c: Pick<Thread, "overrides">, col: ThreadColumn) {
  const { edits, removed, placed, merged } = c.overrides
  const defs = new Map((col.groups ?? []).map((g) => [g.id, g]))
  // Where a group's papers are now: itself, or where they went; undefined for nowhere
  const target = (id: string | undefined): string | undefined => {
    const seen = new Set<string>()
    while (id !== undefined && !seen.has(id)) {
      seen.add(id)
      const into = merged[`${col.id}:${id}`]
      if (into !== undefined) id = into
      else if (!defs.has(id)) return undefined
      else if (removed[itemId.group(col.id, id)]) id = defs.get(id)!.parent
      else return id
    }
    return undefined
  }
  // The top-level group above a live one (or itself)
  const top = (id: string) => {
    const seen = new Set<string>()
    for (let at = id; ; ) {
      seen.add(at)
      const up = target(defs.get(at)?.parent)
      if (up === undefined || seen.has(up)) return at
      at = up
    }
  }
  const parentOf = (g: ThreadGroup) => {
    const p = target(g.parent)
    if (p === undefined || p === g.id) return undefined
    const above = top(p)
    return above === g.id ? undefined : above
  }
  const groups: ThreadGroup[] = (col.groups ?? [])
    .filter((g) => target(g.id) === g.id)
    .map((g) => {
      const { parent: _parent, ...rest } = g
      const parent = parentOf(g)
      return { ...rest, name: edits[itemId.group(col.id, g.id)]?.text ?? g.name, ...(parent ? { parent } : {}) }
    })
  const parents = new Map(groups.map((g) => [g.id, g.parent]))
  // The user's placements in this grouping, by paper, oldest first
  const byPaper = new Map<string, { group: string; in: boolean; at: number }[]>()
  for (const [key, p] of Object.entries(placed)) {
    if (!key.startsWith(`${col.id}:`)) continue
    const paper = key.slice(col.id.length + 1, key.lastIndexOf(":"))
    const list = byPaper.get(paper) ?? []
    list.push({ group: key.slice(key.lastIndexOf(":") + 1), ...p })
    byPaper.set(paper, list)
  }
  for (const list of byPaper.values()) list.sort((a, b) => a.at - b.at)
  const order = new Map(groups.map((g, i) => [g.id, i]))
  const of = (row: Pick<ThreadRow, "id" | "in">): string[] => {
    const ids = new Set<string>()
    for (const id of row.in?.[col.id] ?? []) {
      const at = target(id)
      if (at) ids.add(at)
    }
    for (const p of byPaper.get(row.id) ?? []) {
      const at = target(p.group)
      if (!at) continue
      if (p.in) ids.add(at)
      else ids.delete(at)
    }
    for (const id of [...ids]) {
      const parent = parents.get(id)
      if (parent) ids.delete(parent)
    }
    return [...ids].filter((id) => order.has(id)).sort((a, b) => order.get(a)! - order.get(b)!)
  }
  return { groups, of, target }
}

// The thread as the user sees it: their rewrites in place of Owlit's text, what they removed gone, and
// each grouping as they left it (its groups in the column, each paper's in its row's `in`)
export function shownThread(c: Thread): Thread {
  const { edits, removed } = c.overrides
  const text = (id: string, owlit: string) => edits[id]?.text ?? owlit
  const views = groupingsOf(c).map((col) => ({ col, view: groupingView(c, col) }))
  return {
    ...c,
    title: text(itemId.title(), c.title),
    memo: c.memo.filter((s) => !removed[itemId.memo(s.id)]).map((s) => ({ ...s, text: text(itemId.memo(s.id), s.text) })),
    columns: c.columns.map((col) => (col.kind === "grouping" ? { ...col, groups: views.find((v) => v.col === col)!.view.groups } : col)),
    rows: c.rows
      .filter((r) => !removed[itemId.row(r.id)])
      .map((r) => {
        const { in: _in, ...rest } = r
        const placedIn = Object.fromEntries(views.map(({ col, view }) => [col.id, view.of(r)]).filter(([, ids]) => ids!.length))
        return {
          ...rest,
          cells: Object.fromEntries(Object.entries(r.cells).map(([col, cell]) => [col, { ...cell, text: text(itemId.cell(r.id, col), cell.text) }])),
          ...(Object.keys(placedIn).length ? { in: placedIn } : {}),
        }
      }),
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
  // The whole of one grouping as Owlit means it now: its groups, two levels at most
  groups?: ThreadGroup[]
  // The grouping column that groups and the rows' group(s) are for: the first grouping by default, and a
  // hidden Topic grouping when the thread has none yet
  grouping?: string
  // A new way of grouping the papers, by what it divides them by ("the chapters of the story"): the write's
  // groups and the rows' group(s) are for it. One the thread has already, by the same words, is that one.
  newGrouping?: string
  // Rows Owlit takes out (the user's own removals are separate and stay)
  removeRows?: string[]
  why?: string
  // One sentence on what this batch couldn't reach (a source that failed, an index that is incomplete,
  // papers without an abstract), kept with the batch in About
  note?: string
  chatId?: string
  // The background run writing, as "<kind>:<task id>": its searches and writes are one batch
  run?: string
  // The agent's tool call making this write, when its engine names it
  toolCallId?: string
  docPath?: string
}

// One batch of Owlit's work on a thread, for About: what set it going, what it added or answered,
// the searches it made and what it said it couldn't reach. Worked out from the thread's history.
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
  cells?: Record<string, Omit<ThreadCell, "at">>
  // The groups Owlit puts it in, in the write's grouping, all of them ("" or []: none); group is one
  group?: string
  groups?: string[]
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
  // A paper into one more group of a grouping (in: true), or out of one (false); the others stay
  | { op: "place"; column: string; row: string; group: string; in: boolean }
  // Into a group, out of the one it was opened in (from; "" for none), or out of all of them when from is
  // absent; null: into none
  | { op: "move"; column: string; row: string; group: string | null; from?: string }
  // Undo of place and move: the user's own placements of that paper as they were (null: none)
  | { op: "unplace"; column: string; row: string; placed: Record<string, { in: boolean; at: number } | null> }
  | { op: "ungroup"; column: string; group: string }
  | { op: "merge"; column: string; group: string; into: string }
  | { op: "unmerge"; column: string; group: string }
  // A column out of sight, or back
  | { op: "hide"; column: string; hidden: boolean }
  | { op: "project"; project: string }
  // What the table is grouped by, remembered for the thread (overrides.view)
  | { op: "view"; groupBy: string }

// Owlit's own text for an item, before the user's rewrite
export function owlitText(c: Thread, item: string): string | undefined {
  if (item === itemId.title()) return c.title
  const [kind, a, b] = item.split(":")
  if (kind === "memo") return c.memo.find((s) => s.id === a)?.text
  if (kind === "cell") return c.rows.find((r) => r.id === a)?.cells[b!]?.text
  if (kind === "group") return c.columns.find((col) => col.id === a && col.kind === "grouping")?.groups?.find((g) => g.id === b)?.name
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
      if (sameWords(text, owlit)) delete c.overrides.edits[item]
      else c.overrides.edits[item] = { text, at: now, was: owlit }
      return { items: [item] }
    }
    case "revert":
      delete c.overrides.edits[edit.item]
      return { items: [edit.item] }
    case "remove": {
      const text = removedText(c, edit.item)
      if (text === undefined) return { problem: "gone" }
      c.overrides.removed[edit.item] = { text, at: now }
      return { items: [edit.item] }
    }
    case "unremove":
      delete c.overrides.removed[edit.item]
      return { items: [edit.item] }
    // Groups change in overrides, never in Owlit's grouping, so a later write of Owlit's can't undo them
    case "place":
    case "move": {
      const row = c.rows.find((r) => r.id === edit.row)
      const col = c.columns.find((x) => x.id === edit.column && x.kind === "grouping")
      if (!row) return { problem: "row" }
      if (!col) return { problem: "group" }
      const view = groupingView(c, col)
      if (edit.group && !view.groups.some((g) => g.id === edit.group)) return { problem: "group" }
      const put = (group: string, into: boolean) => (c.overrides.placed[placedKey(col.id, row.id, group)] = { in: into, at: now })
      if (edit.op === "place") put(edit.group, edit.in)
      else {
        const out = edit.from === undefined ? view.of(row) : edit.from ? [edit.from] : []
        for (const id of out) if (id !== edit.group) put(id, false)
        if (edit.group) put(edit.group, true)
      }
      return { items: [itemId.row(edit.row)] }
    }
    case "unplace":
      for (const [group, p] of Object.entries(edit.placed)) {
        const key = placedKey(edit.column, edit.row, group)
        if (p) c.overrides.placed[key] = p
        else delete c.overrides.placed[key]
      }
      return { items: [itemId.row(edit.row)] }
    case "unmerge":
      delete c.overrides.merged[`${edit.column}:${edit.group}`]
      return { items: [itemId.group(edit.column, edit.group)] }
    case "ungroup":
    case "merge": {
      const col = c.columns.find((x) => x.id === edit.column && x.kind === "grouping")
      const groups = col ? groupingView(c, col).groups : []
      const group = groups.find((g) => g.id === edit.group)
      if (!col || !group || (edit.op === "merge" && (edit.into === group.id || !groups.some((g) => g.id === edit.into)))) return { problem: "group" }
      if (edit.op === "merge") c.overrides.merged[`${col.id}:${group.id}`] = edit.into
      else c.overrides.removed[itemId.group(col.id, group.id)] = { text: group.name, at: now }
      return { items: [itemId.group(col.id, group.id)] }
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
      c.overrides.view = { ...c.overrides.view, groupBy: edit.groupBy }
      return { items: [] }
  }
}

// A thread as version 1 kept it: one grouping in `groups`, each row's group on the row
type ThreadV1 = Omit<Thread, "version" | "rows" | "overrides" | "splitFrom"> & {
  version: 1
  groups: ThreadGroup[]
  rows: (Omit<ThreadRow, "in"> & { group?: string })[]
  overrides: Pick<ThreadOverrides, "edits" | "removed">
  splitFrom?: { id: string; rows: (Omit<ThreadRow, "in"> & { group?: string })[]; asked?: ThreadAsked }
}

// A thread as it is kept now, from any version. Version 1's groups become a hidden grouping column
// (Topic), each row's group its place there, and a renamed group's item gains the column. Which of the
// rows' groups were the user's moves can't be told any more: they all become Owlit's.
export function upgradeThread(c: Thread | ThreadV1): Thread {
  if (c.version !== 1) return c
  const { groups, ...rest } = c
  let col: string | undefined
  if (groups.length || c.rows.some((r) => r.group)) {
    col = GROUPING_COLUMN
    for (let n = 2; c.columns.some((x) => x.id === col); n++) col = `${GROUPING_COLUMN}${n}`
  }
  // A kept-apart row goes back into the thread it came from, whose grouping is Topic
  const row = (r: ThreadV1["rows"][number], into: string | undefined): ThreadRow => {
    const { group, ...kept } = r
    return group && into ? { ...kept, in: { [into]: [group] } } : kept
  }
  const rekey = <T>(items: Record<string, T>) => Object.fromEntries(Object.entries(items).map(([k, v]) => [col && /^group:[^:]+$/.test(k) ? `group:${col}:${k.slice(6)}` : k, v]))
  return {
    ...rest,
    version: 2,
    columns: col ? [...c.columns, { id: col, question: "Topic", kind: "grouping", hidden: true, groups }] : c.columns,
    rows: c.rows.map((r) => row(r, col)),
    overrides: { edits: rekey(c.overrides.edits), removed: rekey(c.overrides.removed), placed: {}, merged: {} },
    ...(c.splitFrom ? { splitFrom: { ...c.splitFrom, rows: c.splitFrom.rows.map((r) => row(r, GROUPING_COLUMN)) } } : {}),
  }
}
