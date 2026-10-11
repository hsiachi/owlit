import { DAY } from "@/lib/time"
import type { Paper } from "../types"
import type { Sort, StatusFilter } from "../ui-store"

const firstSurname = (p: Paper) => p.authors[0]?.trim().split(/\s+/).at(-1) ?? ""

export function matchesQuery(p: Paper, q: string): boolean {
  if (!q) return true
  const hay = [p.title, ...p.authors, p.venue ?? "", String(p.year ?? ""), ...p.tags]
    .join(" ")
    .toLowerCase()
  // Every word must appear somewhere
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

export function matchesFilter(p: Paper, f: StatusFilter): boolean {
  switch (f) {
    case "all":
      return true
    case "starred":
      return p.starred
    case "needs":
      return !!p.noPdf?.needs
    default:
      return p.status === f
  }
}

export function compare(a: Paper, b: Paper, sort: Sort): number {
  let r = 0
  switch (sort.key) {
    case "addedAt":
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
  }
  if (r === 0) r = b.addedAt - a.addedAt
  return sort.desc ? -r : r
}

export interface ListParams {
  query: string
  filter: StatusFilter
  tags: string[]
  sort: Sort
}

// The rows of All papers: what the search, filter chips, tag filter and sort leave. Papers found only in
// their text (textHits, from the index, best first) follow the ones whose details match, in the index's order.
export function visiblePapers(papers: Record<string, Paper>, params: ListParams, textHits: ReadonlyMap<string, string> = new Map()): Paper[] {
  const q = params.query.trim()
  const kept = (p: Paper) => matchesFilter(p, params.filter) && params.tags.every((t) => p.tags.includes(t))
  const byDetails = Object.values(papers)
    .filter((p) => kept(p) && matchesQuery(p, q))
    .sort((a, b) => compare(a, b, params.sort))
  if (!q || !textHits.size) return byDetails
  const listed = new Set(byDetails.map((p) => p.id))
  const byText = [...textHits.keys()].flatMap((id) => (papers[id] && !listed.has(id) && kept(papers[id]) ? [papers[id]] : []))
  return [...byDetails, ...byText]
}

export function countByFilter(papers: Record<string, Paper>): Record<StatusFilter, number> {
  const c: Record<StatusFilter, number> = { all: 0, starred: 0, unread: 0, reading: 0, read: 0, needs: 0 }
  for (const p of Object.values(papers)) {
    c.all++
    if (p.starred) c.starred++
    if (p.noPdf?.needs) c.needs++
    c[p.status]++
  }
  return c
}

export interface PaperGroup {
  label: string | null
  papers: Paper[]
}

const AGE_BANDS: [string, number][] = [
  ["Today", DAY],
  ["Previous 7 days", 7 * DAY],
  ["Previous 30 days", 30 * DAY],
  ["Earlier", Infinity],
]

// The list layout's groups, in the spirit of the chat history: by age when sorted by date added,
// by year when sorted by year, one count while searching, and none for the alphabetical sorts
export function groupPapers(papers: Paper[], sort: Sort, searching: boolean, now = Date.now()): PaperGroup[] {
  if (searching) return [{ label: `${papers.length} ${papers.length === 1 ? "paper" : "papers"}`, papers }]
  if (sort.key === "addedAt") {
    const groups = AGE_BANDS.map(([label]) => ({ label, papers: [] as Paper[] }))
    for (const p of papers) groups[AGE_BANDS.findIndex(([, max]) => now - p.addedAt < max)].papers.push(p)
    if (!sort.desc) groups.reverse()
    return groups.filter((g) => g.papers.length > 0)
  }
  if (sort.key === "year") {
    const groups: PaperGroup[] = []
    for (const p of papers) {
      const label = p.year ? String(p.year) : "No year"
      const last = groups.at(-1)
      if (last?.label === label) last.papers.push(p)
      else groups.push({ label, papers: [p] })
    }
    return groups
  }
  return [{ label: null, papers }]
}
