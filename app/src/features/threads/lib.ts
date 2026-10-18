import { t } from "@lingui/core/macro"
import { GROUPING_COLUMN, MENTION_LINK, mentionLink, type Paper, QUESTION_COLUMN, type Relation, shownThread, summarize, type Thread, type ThreadColumn, type ThreadGroup, type ThreadPaper, type ThreadRow, type ThreadSummary } from "@owlit/protocol"
import { displayName } from "@/features/docs/types"
import { citationLabel } from "@/features/library/lib/format"
import { paperById, useLibraryStore } from "@/features/library/store"

// Worked out once per thread object, which is safe because the store replaces a thread on every
// change and never changes one in place. Shared between callers, so not to be changed either.
function perThread<T>(build: (c: Thread) => T) {
  const cache = new WeakMap<Thread, T>()
  return (c: Thread) => {
    let value = cache.get(c)
    if (value === undefined) cache.set(c, (value = build(c)))
    return value
  }
}

// The thread as the user sees it (shownThread), and what the list of threads shows of it
export const shown = perThread(shownThread)
export const summaryOf = perThread(summarize)

// The Library's papers by lowercased DOI and by arXiv id, each with its place in the list, built once per
// papers object (the store replaces it on every change). A row looks its paper up on every change to the
// Library, so this saves walking every paper per row.
type ByIds = { doi: Map<string, [number, Paper]>; arxiv: Map<string, [number, Paper]> }
const idIndexes = new WeakMap<Record<string, Paper>, ByIds>()
function byIds(papers: Record<string, Paper>): ByIds {
  let index = idIndexes.get(papers)
  if (index) return index
  index = { doi: new Map(), arxiv: new Map() }
  Object.values(papers).forEach((p, at) => {
    const doi = p.ids.doi?.toLowerCase()
    if (doi && !index.doi.has(doi)) index.doi.set(doi, [at, p])
    if (p.ids.arxiv && !index.arxiv.has(p.ids.arxiv)) index.arxiv.set(p.ids.arxiv, [at, p])
  })
  idIndexes.set(papers, index)
  return index
}

// The Library's own record of a row's paper, when the paper is there: by the row's id, an id it had
// before, or a shared DOI or arXiv id (a paper added by hand gets the same id, but one dropped in as a PDF
// may not). Of two papers sharing them, the first in the Library.
function libraryPaperOf(row: Pick<ThreadRow, "id" | "paper">, papers: Record<string, Paper>, aliases: Record<string, string>): Paper | undefined {
  const direct = paperById(papers, aliases, row.id)
  if (direct) return direct
  const { doi, arxiv } = row.paper.ids
  if (!doi && !arxiv) return undefined
  const index = byIds(papers)
  const byDoi = doi ? index.doi.get(doi.toLowerCase()) : undefined
  const byArxiv = arxiv ? index.arxiv.get(arxiv) : undefined
  if (byDoi && byArxiv) return byDoi[0] <= byArxiv[0] ? byDoi[1] : byArxiv[1]
  return (byDoi ?? byArxiv)?.[1]
}

// Only the row's own paper: a row draws again when that paper changes, not on every change to the Library
export const useLibraryPaper = (row: Pick<ThreadRow, "id" | "paper">) => useLibraryStore((s) => libraryPaperOf(row, s.papers, s.aliases))

// What a paper is, as the user sees it: the Library's record wins (their corrections are in it)
export function paperFacts(row: ThreadRow, library: Paper | undefined): ThreadPaper {
  if (!library) return row.paper
  return { ...row.paper, title: library.title, authors: library.authors, year: library.year, venue: library.venue, abstract: library.abstract ?? row.paper.abstract }
}

// The thread as the user sees it, for what leaves the app (Export as a doc, CSV): each row's paper with
// the Library's facts, as the table shows it
export function withLibraryFacts(c: Thread): Thread {
  const { papers, aliases } = useLibraryStore.getState()
  return { ...c, rows: c.rows.map((r) => ({ ...r, paper: paperFacts(r, libraryPaperOf(r, papers, aliases)) })) }
}

// "Chang et al. 2023"
export const citeOf = (p: Pick<ThreadPaper, "authors" | "year">) => citationLabel({ authors: p.authors, year: p.year })

// "CiteSee": the name a paper goes by, the words before its title's colon or dash. The memo names papers
// the same way (the agent rules ask for it), so a row can be found from a sentence by eye. A title without
// such a name stays whole.
export function shortTitle(title: string): string {
  const m = /^(.{2,48}?)\s*(?::|\s[—–-]\s)\s*\S/.exec(title.trim())
  return m ? m[1]! : title.trim()
}

// "CiteSee · 2023", how a row names its paper
export const nameOf = (p: Pick<ThreadPaper, "title" | "year">) => [shortTitle(p.title), p.year].filter(Boolean).join(" · ")

// A sentence of Owlit's with the papers and groups it names as mentions
export type MemoPart = string | { label: string; uri: string }

export function memoParts(text: string): MemoPart[] {
  const out: MemoPart[] = []
  const pattern = new RegExp(MENTION_LINK.source, "g")
  let last = 0
  for (const m of text.matchAll(pattern)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push({ label: m[1]!.replace(/\\(.)/g, "$1"), uri: m[2]! })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// The list's groups: one per project, the most recently changed project first, then the threads that
// belong to none. A list with no projects at all has one group and no label.
export function byProject(list: ThreadSummary[]): { key: string; label?: string; threads: ThreadSummary[] }[] {
  const groups = new Map<string, ThreadSummary[]>()
  for (const c of list) groups.set(c.project, [...(groups.get(c.project) ?? []), c])
  const projects = [...groups.keys()].filter((p) => p)
  if (!projects.length) return list.length ? [{ key: "", threads: list }] : []
  return [
    ...projects.map((p) => ({ key: p, label: p, threads: groups.get(p)! })),
    ...(groups.has("") ? [{ key: "", label: t({ message: "Not in a project", comment: "group of threads that belong to no project folder" }), threads: groups.get("")! }] : []),
  ]
}

// The paper's page at the words an answer rests on
export const passageRoute = (paperId: string, passage?: { quote: string; page: number }) =>
  `/library/${paperId}${passage ? `?quote=${encodeURIComponent(passage.quote)}&page=${passage.page}` : ""}`

// A sentence to edit as plain words, and back: the names it linked stay linked wherever the rewrite keeps
// them word for word (the first time each appears)
export function plainMemo(text: string): { plain: string; links: { label: string; uri: string }[] } {
  const parts = memoParts(text)
  return { plain: parts.map((p) => (typeof p === "string" ? p : p.label)).join(""), links: parts.filter((p): p is { label: string; uri: string } => typeof p !== "string") }
}

export function relinkMemo(plain: string, links: { label: string; uri: string }[]): string {
  let out = plain
  let from = 0
  for (const l of links) {
    const at = out.indexOf(l.label, from)
    if (at < 0) continue
    const md = mentionLink(l.label, l.uri)
    out = out.slice(0, at) + md + out.slice(at + l.label.length)
    from = at + md.length
  }
  return out
}

// What a thread says about one of its papers, a line per column with an answer: the answer to its
// question first and unlabelled, then each question asked of every paper, then how the paper stands on the
// user's sentences. The user's rewrites are in it.
function paperLines(shown: Thread, row: ThreadRow): { label?: string; text: string }[] {
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

// Which threads hold each Library paper, newest change first: by the row's id, or a shared DOI or
// arXiv id, with what each says about it. Rows the user removed don't count.
export function threadsByPaper(threads: Record<string, Thread>, papers: Record<string, Paper>, aliases: Record<string, string>): Map<string, { id: string; title: string; lines: { label?: string; text: string }[] }[]> {
  const out = new Map<string, { id: string; title: string; lines: { label?: string; text: string }[] }[]>()
  const ordered = Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt)
  for (const c of ordered) {
    const view = shown(c)
    for (const row of view.rows) {
      const paper = libraryPaperOf(row, papers, aliases)
      if (!paper) continue
      const list = out.get(paper.id) ?? []
      if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, title: view.title, lines: paperLines(view, row) })
      out.set(paper.id, list)
    }
  }
  return out
}

// The thread that holds a paper the Library hasn't got, so a link to the paper can open it there
export function threadHolding(threads: Record<string, Thread>, paperId: string): Thread | undefined {
  return Object.values(threads)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((c) => c.rows.some((r) => r.id === paperId) && !c.yours.removed[`row:${paperId}`])
}

// A grouping's groups as the table shows them, in order with each subgroup after its parent: the papers
// right in each, and all it holds with its subgroups' papers once each, which its count says. A paper in two
// groups counts in both; a group whose papers all went elsewhere is left out. Then the papers in none.
export function groupSections(shown: Thread, grouping: ThreadColumn) {
  // The shown grouping keeps two levels and each paper in live groups only (shownThread)
  const groups = grouping.groups ?? []
  const members = (id: string) => shown.rows.filter((r) => r.in?.[grouping.id]?.includes(id))
  const out: { group: ThreadGroup; rows: ThreadRow[]; total: ThreadRow[]; depth: number }[] = []
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

// Words that end in a full stop without ending the sentence, as citations and asides use them
const NOT_AN_END = /(?:\bet al|\be\.g|\bi\.e|\bcf|\bvs|\bFigs?|\bEqs?|\bSec|\bpp?|\bvol|\bno|\b[A-Z])\.$/i
// Chinese and Japanese say in one character what English says in about three
const WIDE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/g
const weight = (s: string) => s.length + 2 * (s.match(WIDE)?.length ?? 0)

// A doc's sentences, as the user might want them weighed (Compare with a doc): its lines split at sentence
// ends, headings and list marks taken off, very short pieces left out. A link's label never splits a
// sentence, nor does "et al." or an initial; a Chinese full stop ends one with no space after it.
export function sentencesOf(markdown: string): string[] {
  const out: string[] = []
  for (const raw of markdown.split("\n")) {
    const labels: string[] = []
    const line = raw
      .replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, (_, label: string) => `\u0000${labels.push(label) - 1}\u0000`)
      .replace(/[*_`]/g, "")
      .trim()
    if (!line) continue
    const pieces: string[] = []
    let start = 0
    for (const end of line.matchAll(/[.!?]+(?=\s)|[。！？]+/g)) {
      const at = end.index + end[0].length
      if (end[0] === "." && NOT_AN_END.test(line.slice(start, at))) continue
      pieces.push(line.slice(start, at))
      start = at
    }
    pieces.push(line.slice(start))
    for (const piece of pieces) {
      const s = piece.replace(/\u0000(\d+)\u0000/g, (_, i: string) => labels[Number(i)]!).trim()
      if (weight(s) >= 12) out.push(s)
    }
  }
  return out
}
