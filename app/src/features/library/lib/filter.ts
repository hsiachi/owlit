import type { Paper, ReadStatus } from "../types"
import type { Sort, StatusFilter } from "../ui-store"

const STATUS_RANK: Record<ReadStatus, number> = { unread: 0, reading: 1, read: 2 }

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
    case "venue":
      r = (a.venue ?? "").localeCompare(b.venue ?? "")
      break
    case "status":
      r = STATUS_RANK[a.status] - STATUS_RANK[b.status]
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

// The table's rows: what the toolbar's search, filter chips, tag filter and sort leave
export function visiblePapers(papers: Record<string, Paper>, params: ListParams): Paper[] {
  const q = params.query.trim()
  return Object.values(papers)
    .filter((p) => matchesFilter(p, params.filter))
    .filter((p) => params.tags.every((t) => p.tags.includes(t)))
    .filter((p) => matchesQuery(p, q))
    .sort((a, b) => compare(a, b, params.sort))
}

export function countByFilter(papers: Record<string, Paper>): Record<StatusFilter, number> {
  const c: Record<StatusFilter, number> = { all: 0, starred: 0, unread: 0, reading: 0, read: 0 }
  for (const p of Object.values(papers)) {
    c.all++
    if (p.starred) c.starred++
    c[p.status]++
  }
  return c
}
