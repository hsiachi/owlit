import { plural, t } from "@lingui/core/macro"
import { DAY } from "@/lib/time"
import { hasAllWords, queryWords } from "@/lib/words"
import type { Paper } from "@owlit/protocol"
import { surname } from "./format"
import { pdfColumnWord, pdfWait, pdfWord, type PdfWait } from "./pdf-wait"
import type { Sort, StatusFilter } from "../ui-store"

const firstSurname = (p: Paper) => (p.authors[0] ? surname(p.authors[0]) : "")

export function matchesQuery(p: Paper, q: string): boolean {
  if (!q) return true
  // Every word must appear somewhere
  return hasAllWords([p.title, ...p.authors, p.venue ?? "", String(p.year ?? ""), ...p.tags].join(" "), queryWords(q))
}

// The No PDF view's groups, in this order: what the user can do now, what the tries found, then papers
// in line at the extension and those owlit looks for itself. Each group is named by the word its rows say
// (pdfColumnWord), so a paper in line is under Waiting, not Finding, and one at a site waiting on the user
// under that wait's word (Needs verification).
const NO_PDF_ORDER: PdfWait[] = ["manual", "for-sign-in", "for-check", "for-permission", "blocked", "not-found", "no-access", "not-offered", "not-there", "skipped", "finding", "offline"]

const lacksPdf = (p: Paper) => !!pdfWait(p)

function matchesFilter(p: Paper, f: StatusFilter): boolean {
  switch (f) {
    case "all":
      return true
    case "starred":
      return p.starred
    case "no-pdf":
      return lacksPdf(p)
    default:
      return p.status === f
  }
}

export function compare(a: Paper, b: Paper, sort: Sort): number {
  let r = 0
  switch (sort.key) {
    case "addedAt":
    case "thread":
      r = a.addedAt - b.addedAt
      break
    case "title":
      r = a.title.localeCompare(b.title)
      break
    case "year":
      r = (a.year ?? 0) - (b.year ?? 0)
      break
    case "authors":
      r = firstSurname(a).localeCompare(firstSurname(b))
      break
    case "venue":
      r = (a.venue ?? "").localeCompare(b.venue ?? "")
      break
    // A paper no service has counted goes after the ones cited least when the most cited lead
    case "citations":
      r = (a.citations?.count ?? -1) - (b.citations?.count ?? -1)
      break
  }
  if (r === 0) r = b.addedAt - a.addedAt
  return sort.desc ? -r : r
}

interface ListParams {
  query: string
  filter: StatusFilter
  tags: string[]
  sort: Sort
  only?: { ids: string[] } | null
}

// The rows of All papers: what the search, filter chips, tag filter and sort leave. Papers found only in
// their text (textHits, from the index, best first) follow the ones whose details match, in the index's order.
export function visiblePapers(papers: Record<string, Paper>, params: ListParams, textHits: ReadonlyMap<string, string> = new Map()): Paper[] {
  const q = params.query.trim()
  const only = params.only ? new Set(params.only.ids) : null
  const kept = (p: Paper) => (!only || only.has(p.id)) && matchesFilter(p, params.filter) && params.tags.every((tag) => p.tags.includes(tag))
  const byDetails = Object.values(papers)
    .filter((p) => kept(p) && matchesQuery(p, q))
    .sort((a, b) => compare(a, b, params.sort))
  if (!q || !textHits.size) return byDetails
  const listed = new Set(byDetails.map((p) => p.id))
  const byText = [...textHits.keys()].flatMap((id) => (papers[id] && !listed.has(id) && kept(papers[id]) ? [papers[id]] : []))
  return [...byDetails, ...byText]
}

export function countByFilter(papers: Record<string, Paper>): Record<StatusFilter, number> {
  const c: Record<StatusFilter, number> = { all: 0, starred: 0, unread: 0, reading: 0, read: 0, "no-pdf": 0 }
  for (const p of Object.values(papers)) {
    c.all++
    if (p.starred) c.starred++
    if (lacksPdf(p)) c["no-pdf"]++
    c[p.status]++
  }
  return c
}

export interface PaperGroup {
  label: string | null
  papers: Paper[]
}

const ageBands = (): [string, number][] => [
  [t`Today`, DAY],
  [t`Previous 7 days`, 7 * DAY],
  [t`Previous 30 days`, 30 * DAY],
  [t`Earlier`, Infinity],
]

// The list layout's groups, in the spirit of the chat history: by age when sorted by date added,
// by year when sorted by year, one count while searching, and none for the alphabetical sorts. Papers
// without a PDF (the No PDF filter) by why, whatever the sort, which orders each group.
export function groupPapers(
  papers: Paper[],
  sort: Sort,
  searching: boolean,
  now = Date.now(),
  threads?: Map<string, { id: string; title: string }[]>,
  byReason = false,
): PaperGroup[] {
  if (searching) return [{ label: plural(papers.length, { one: "# paper", other: "# papers" }), papers }]
  if (byReason) {
    const groups = new Map<string, { rank: number; papers: Paper[] }>()
    for (const p of papers) {
      const label = pdfColumnWord(p)
      if (!label) continue
      // A paper in line (Waiting) goes just before owlit's own looking (Finding)
      const rank = NO_PDF_ORDER.indexOf(pdfWait(p)!) - (label !== pdfWord("finding") && pdfWait(p) === "finding" ? 0.5 : 0)
      const group = groups.get(label) ?? { rank, papers: [] }
      group.rank = Math.min(group.rank, rank)
      group.papers.push(p)
      groups.set(label, group)
    }
    return [...groups].sort((a, b) => a[1].rank - b[1].rank).map(([label, g]) => ({ label, papers: g.papers }))
  }
  // By the thread that holds a paper (the most recently changed one, when several do); papers that
  // came some other way last
  if (sort.key === "thread") {
    const groups = new Map<string, PaperGroup>()
    const outside: Paper[] = []
    for (const p of papers) {
      const c = threads?.get(p.id)?.[0]
      if (!c) {
        outside.push(p)
        continue
      }
      if (!groups.has(c.id)) groups.set(c.id, { label: c.title, papers: [] })
      groups.get(c.id)!.papers.push(p)
    }
    return [...groups.values(), ...(outside.length ? [{ label: t({ message: "Not from a thread", comment: "Library papers no thread holds" }), papers: outside }] : [])]
  }
  if (sort.key === "addedAt") {
    const bands = ageBands()
    const groups = bands.map(([label]) => ({ label, papers: [] as Paper[] }))
    for (const p of papers) groups[bands.findIndex(([, max]) => now - p.addedAt < max)].papers.push(p)
    if (!sort.desc) groups.reverse()
    return groups.filter((g) => g.papers.length > 0)
  }
  if (sort.key === "year") {
    const groups: PaperGroup[] = []
    for (const p of papers) {
      const label = p.year ? String(p.year) : t`No year`
      const last = groups.at(-1)
      if (last?.label === label) last.papers.push(p)
      else groups.push({ label, papers: [p] })
    }
    return groups
  }
  return [{ label: null, papers }]
}
