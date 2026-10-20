import { t } from "@lingui/core/macro"
import { GROUPING_COLUMN, type Paper, QUESTION_COLUMN, type Relation, shortTitle, shownThread, summarize, type ThreadRead, type ThreadColumn, type ThreadGroup, type ThreadPaper, type ThreadRowRead, type ThreadSummary } from "@owlit/protocol"
import { displayName } from "@/features/docs/types"
import { citationLabel } from "@/features/library/lib/format"
import { paperById, useLibraryStore } from "@/features/library/store"

// Worked out once per thread object, which is safe because the store replaces a thread on every
// change and never changes one in place. Shared between callers, so not to be changed either.
function perThread<T>(build: (c: ThreadRead) => T) {
  const cache = new WeakMap<ThreadRead, T>()
  return (c: ThreadRead) => {
    let value = cache.get(c)
    if (value === undefined) cache.set(c, (value = build(c)))
    return value
  }
}

// The thread as the user sees it (shownThread), and what the list of threads shows of it
export const shown = perThread(shownThread)
export const summaryOf = perThread(summarize)

// A row is a Library paper by its id (core names every row so); the Library's own record of it, for what
// only the Library says (the PDF, the reading mark) and for the user's corrections since core gave the
// thread out. Only the row's own paper: a row draws again when that paper changes, not on every change to
// the Library.
export const useLibraryPaper = (row: Pick<ThreadRowRead, "id">) => useLibraryStore((s) => paperById(s.papers, s.aliases, row.id))

// What a paper is, as the user sees it: the Library's record when the window has it, else the facts core
// gave with the row
export function paperFacts(row: ThreadRowRead, library: Paper | undefined): ThreadPaper {
  if (!library) return row.paper
  return { ...row.paper, title: library.title, authors: library.authors, year: library.year, venue: library.venue, abstract: library.abstract ?? row.paper.abstract }
}

// "Chang et al. 2023"
export const citeOf = (p: Pick<ThreadPaper, "authors" | "year">) => citationLabel({ authors: p.authors, year: p.year })

// "CiteSee · 2023", how a row names its paper
export const nameOf = (p: Pick<ThreadPaper, "title" | "year">) => [shortTitle(p.title), p.year].filter(Boolean).join(" · ")

// The list's groups: one per project, the most recently changed project first, then the threads that
// belong to none. A thread whose project is no longer a top-level folder (renamed or deleted; the thread
// still names the old one) is in none, and keeps the old name as `was`. projects: the workspace's folders,
// undefined until they are known, when every project counts. A list with no projects at all has one group
// and no label.
export function byProject(list: ThreadSummary[], projects?: string[]): { key: string; label?: string; threads: (ThreadSummary & { was?: string })[] }[] {
  const live = (p: string) => !!p && (!projects || projects.includes(p))
  const groups = new Map<string, (ThreadSummary & { was?: string })[]>()
  for (const c of list) {
    const key = live(c.project) ? c.project : ""
    groups.set(key, [...(groups.get(key) ?? []), key || !c.project ? c : { ...c, was: c.project }])
  }
  const named = [...groups.keys()].filter((p) => p)
  if (!named.length) return list.length ? [{ key: "", threads: groups.get("")! }] : []
  return [
    ...named.map((p) => ({ key: p, label: p, threads: groups.get(p)! })),
    ...(groups.has("") ? [{ key: "", label: t({ message: "Not in a project", comment: "group of threads that belong to no project folder" }), threads: groups.get("")! }] : []),
  ]
}

// The paper's page at the words an answer rests on
export const passageRoute = (paperId: string, passage?: { quote: string; page: number }) =>
  `/library/${paperId}${passage ? `?quote=${encodeURIComponent(passage.quote)}&page=${passage.page}` : ""}`

// What a thread says about one of its papers, a line per column with an answer: the answer to its
// question first and unlabelled, then each question asked of every paper, then how the paper stands on the
// user's sentences.
function paperLines(shown: ThreadRead, row: ThreadRowRead): { label?: string; text: string }[] {
  const out: { label?: string; text: string }[] = []
  for (const col of shown.columns) {
    const cell = row.cells[col.id]
    if (col.hidden || !cell?.text) continue
    if (col.id === QUESTION_COLUMN) out.unshift({ text: cell.text })
    else if (col.kind === "compare") {
      if (!cell.rel) continue
      const sentence = col.sentences?.find((s) => s.id === cell.sentence)?.text
      // Owlit's reason first, as in the table, then which of the user's sentences it is about
      out.push({ label: relWord(cell.rel), text: sentence ? `${cell.text} (“${sentence}”)` : cell.text })
    } else out.push({ label: col.question, text: cell.text })
  }
  return out
}

// A column's name in its header and in an export
export function columnLabel(col: ThreadColumn) {
  if (col.id === QUESTION_COLUMN) return t({ message: "Answer", comment: "column: what a paper says about the thread's question" })
  // The grouping Owlit makes without being asked which way is named in the app's language
  if (col.kind === "grouping" && col.id === GROUPING_COLUMN && col.question === "Topic") return t({ message: "Topic", comment: "group a thread's papers by Owlit's groups" })
  if (col.kind === "compare") {
    const doc = displayName(col.doc ?? col.question)
    return t`Compared with ${doc}`
  }
  return col.question
}

export const relWord = (rel: Relation) =>
  ({
    supports: t({ message: "Supports", comment: "a paper's findings back one of the user's sentences" }),
    challenges: t({ message: "Challenges", comment: "a paper's findings cut against or qualify one of the user's sentences" }),
    related: t({ message: "Related", comment: "a paper on the same matter as one of the user's sentences, without settling it" }),
  })[rel]

// Which threads hold each Library paper, newest change first, with what each says about it
export function threadsByPaper(threads: Record<string, ThreadRead>, papers: Record<string, Paper>, aliases: Record<string, string>): Map<string, { id: string; title: string; lines: { label?: string; text: string }[] }[]> {
  const out = new Map<string, { id: string; title: string; lines: { label?: string; text: string }[] }[]>()
  const ordered = Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt)
  for (const c of ordered) {
    const view = shown(c)
    for (const row of view.rows) {
      const paper = paperById(papers, aliases, row.id)
      if (!paper) continue
      const list = out.get(paper.id) ?? []
      if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, title: view.title, lines: paperLines(view, row) })
      out.set(paper.id, list)
    }
  }
  return out
}

// The thread that holds a paper the Library hasn't got, so a link to the paper can open it there
export function threadHolding(threads: Record<string, ThreadRead>, paperId: string): ThreadRead | undefined {
  return Object.values(threads)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((c) => c.rows.some((r) => r.id === paperId))
}

// A grouping's groups as the table shows them, in order with each subgroup after its parent: the papers
// right in each, and all it holds with its subgroups' papers once each, which its count says. A paper in two
// groups counts in both; a group whose papers all went elsewhere is left out. Then the papers in none.
export function groupSections(shown: ThreadRead, grouping: ThreadColumn) {
  // The shown grouping keeps two levels and each paper in live groups only (shownThread)
  const groups = grouping.groups ?? []
  const members = (id: string) => shown.rows.filter((r) => r.in?.[grouping.id]?.includes(id))
  const out: { group: ThreadGroup; rows: ThreadRowRead[]; total: ThreadRowRead[]; depth: number }[] = []
  const add = (g: ThreadGroup, depth: number) => {
    const rows = members(g.id)
    const children = groups.filter((c) => c.parent === g.id)
    const total = [...new Set([...rows, ...children.flatMap((c) => members(c.id))])]
    if (!total.length) return
    out.push({ group: g, rows, total, depth })
    for (const c of children) add(c, depth + 1)
  }
  for (const g of groups.filter((g) => !g.parent)) add(g, 0)
  return { groups: out, loose: shown.rows.filter((r) => !r.in?.[grouping.id]?.length) }
}

// The grouping a thread's page shows its papers by: the one its table was last grouped by, else the first
// with groups. A grouping is not a column, so a thread with groups and no asked column still reads as a
// note, its groups as headings.
export function shownGrouping(shown: ThreadRead): ThreadColumn | undefined {
  const by = groupByOf(shown)
  return by.startsWith("grouping:") ? shown.columns.find((c) => c.id === by.slice(9)) : undefined
}

// The note's sections: a grouping's groups with their papers (groupSections), then the papers in none;
// without a grouping, one section of every paper and no heading
export function noteSections(shown: ThreadRead): { key: string; group?: ThreadGroup; grouping?: ThreadColumn; rows: ThreadRowRead[]; total: number; depth: number }[] {
  const grouping = shownGrouping(shown)
  if (!grouping) return shown.rows.length ? [{ key: "", rows: shown.rows, total: shown.rows.length, depth: 0 }] : []
  const { groups, loose } = groupSections(shown, grouping)
  return [
    ...groups.map((g) => ({ key: g.group.id, group: g.group, grouping, rows: g.rows, total: g.total.length, depth: g.depth })),
    ...(loose.length ? [{ key: "", rows: loose, total: loose.length, depth: 0 }] : []),
  ]
}

// Whether a thread reads as a table: once a question beyond its own, or a comparison, is a shown column
export const isTable = (shown: ThreadRead) => shown.columns.some((c) => c.id !== QUESTION_COLUMN && c.kind !== "grouping" && !c.hidden)

// The papers, the groups they are in and how many Owlit read in full, for the line over the papers
export function paperCounts(shown: ThreadRead) {
  const grouping = shownGrouping(shown)
  const groups = grouping ? groupSections(shown, grouping).groups.filter((g) => g.depth === 0).length : 0
  const full = shown.rows.filter((r) => r.cells[QUESTION_COLUMN]?.depth === "full").length
  return { papers: shown.rows.length, groups, full }
}

// What a thread's table is grouped by: one of its groupings, a comparison's sentences, or none
export type GroupBy = "none" | `grouping:${string}` | `column:${string}`

// The groupings the table can be grouped by: those with groups, hidden or not (a grouping's own sections
// already say what it would show as a column)
export const groupingsWithGroups = (shown: ThreadRead) => shown.columns.filter((c) => c.kind === "grouping" && !!c.groups?.length)

// What the table is grouped by, and an export after it: what the user chose (`want`, else the thread's
// view) while it names something the thread still has, else the first grouping
export function groupByOf(shown: ThreadRead, want: string | undefined = shown.view?.groupBy): GroupBy {
  const groupings = groupingsWithGroups(shown)
  if (want === "none") return want
  if (want?.startsWith("grouping:") && groupings.some((c) => c.id === want.slice(9))) return want as GroupBy
  if (want?.startsWith("column:") && shown.columns.some((c) => c.kind === "compare" && !c.hidden && c.id === want.slice(7))) return want as GroupBy
  return groupings[0] ? `grouping:${groupings[0].id}` : "none"
}

export interface Section {
  key: string
  group?: ThreadGroup
  // A sentence of the user's, when grouped by a comparison
  sentence?: { id: string; text: string }
  // "" for the one unlabelled section of a table grouped by nothing
  label: string
  one?: string
  // The papers right in it
  rows: ThreadRowRead[]
  // Its rows and its subgroups' rows, which its counts cover
  total: ThreadRowRead[]
  depth: number
}

// The thread's papers in the sections a grouping makes, in order, a subgroup after its parent; then the
// papers in none
export function sectionsOf(shown: ThreadRead, groupBy: GroupBy): Section[] {
  const out: Section[] = []
  if (groupBy.startsWith("grouping:")) {
    const grouping = shown.columns.find((c) => c.id === groupBy.slice(9))!
    const { groups, loose } = groupSections(shown, grouping)
    for (const g of groups) out.push({ key: g.group.id, group: g.group, label: g.group.name, one: g.group.one, rows: g.rows, total: g.total, depth: g.depth })
    if (loose.length) out.push({ key: "", label: t({ message: "Not in a group", comment: "papers of a thread in none of its groups" }), rows: loose, total: loose, depth: 0 })
  } else if (groupBy.startsWith("column:")) {
    const col = shown.columns.find((c) => c.id === groupBy.slice(7))!
    const placed = new Set<string>()
    for (const s of col.sentences ?? []) {
      const rows = shown.rows.filter((r) => r.cells[col.id]?.sentence === s.id && r.cells[col.id]?.rel)
      for (const r of rows) placed.add(r.id)
      out.push({ key: s.id, sentence: s, label: s.text, rows, total: rows, depth: 0 })
    }
    // With the papers that bear on none, those whose cell names a sentence the column no longer has
    const none = shown.rows.filter((r) => !placed.has(r.id))
    if (none.length) out.push({ key: "", label: t({ message: "Bear on none of them", comment: "papers that speak to none of the user's sentences" }), rows: none, total: none, depth: 0 })
  } else out.push({ key: "", label: "", rows: shown.rows, total: shown.rows, depth: 0 })
  return out
}
