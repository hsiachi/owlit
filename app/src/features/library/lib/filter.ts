import { plural, t } from "@lingui/core/macro"
import { DAY } from "@/lib/time"
import { hasAllWords, queryWords } from "@/lib/words"
import type { Paper } from "../types"
import { surname } from "./format"
import type { Sort, StatusFilter } from "../ui-store"

const firstSurname = (p: Paper) => (p.authors[0] ? surname(p.authors[0]) : "")

export function matchesQuery(p: Paper, q: string): boolean {
  if (!q) return true
  // Every word must appear somewhere
  return hasAllWords([p.title, ...p.authors, p.venue ?? "", String(p.year ?? ""), ...p.tags].join(" "), queryWords(q))
}

// A paper waits on the user while its publisher wants their browser and nothing has said no yet: once
// their browser reached the publisher and was turned away (no access, no PDF there), or was sent and
// nothing came, there is nothing for them to do now, so it leaves the amber rung and its card's Try
// again is all that is left. So Needs you is what Get them would open, the article pages open for the
// user to save from, and a run's papers while it goes on.
// A paper owlit found nothing for counts too while the user's browser is on it (tried from the No PDF
// view): its page waits to be saved like any other.
const ON_IT = new Set(["queued", "opened", "page", "waiting"])
export const needsYou = (p: Paper) =>
  !p.pdf && ((!!p.noPdf?.needs && !p.noPdf.noAccess && p.noPdf.fromBrowser?.state !== "missed") || ON_IT.has(p.noPdf?.fromBrowser?.state ?? ""))

// Why a paper owlit looked for has no PDF, in the order the No PDF view groups them: what the user can do
// now first, then what was found to be missing. A paper still being looked for has no reason yet.
export type NoPdfReason = "needs" | "not-found" | "no-access" | "missing" | "missed"
export const NO_PDF_REASONS: NoPdfReason[] = ["needs", "not-found", "no-access", "missing", "missed"]

export function noPdfReason(p: Paper): NoPdfReason | undefined {
  if (p.pdf || !p.noPdf) return undefined
  if (needsYou(p)) return "needs"
  if (p.noPdf.noAccess) return p.noPdf.noAccess.missing ? "missing" : "no-access"
  if (p.noPdf.fromBrowser?.state === "missed") return "missed"
  return "not-found"
}

// Papers owlit found nothing for whose publisher the user's own browser hasn't been sent to: their
// access and sign-ins may still get the PDF, though owlit doesn't expect it (unlike Needs you)
export const mightComeThroughBrowser = (p: Paper) => noPdfReason(p) === "not-found" && !!p.ids.doi && !p.noPdf?.fromBrowser && !p.noPdf?.sentAt

function matchesFilter(p: Paper, f: StatusFilter): boolean {
  switch (f) {
    case "all":
      return true
    case "starred":
      return p.starred
    case "needs":
      return needsYou(p)
    case "no-pdf":
      return !!noPdfReason(p)
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
  const c: Record<StatusFilter, number> = { all: 0, starred: 0, unread: 0, reading: 0, read: 0, needs: 0, "no-pdf": 0 }
  for (const p of Object.values(papers)) {
    c.all++
    if (p.starred) c.starred++
    if (needsYou(p)) c.needs++
    if (noPdfReason(p)) c["no-pdf"]++
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

const reasonLabels = (): Record<NoPdfReason, string> => ({
  needs: t({ message: "Needs you", comment: "group of papers without a PDF whose publisher wants the user" }),
  "not-found": t({ message: "No PDF found", comment: "group of papers owlit looked for and found no PDF of" }),
  "no-access": t({ message: "No access", comment: "group of papers the user's library doesn't give them" }),
  missing: t({ message: "No PDF there", comment: "group of papers whose publisher has no PDF of them" }),
  missed: t({ message: "Didn't come", comment: "group of papers the user's browser was sent for and no PDF arrived" }),
})

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
    const labels = reasonLabels()
    return NO_PDF_REASONS.map((reason) => ({ label: labels[reason], papers: papers.filter((p) => noPdfReason(p) === reason) })).filter((g) => g.papers.length > 0)
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

// How many unread papers to suggest: enough to pick from, few enough to read as a short list
const UNREAD = 12

// What to read next, in its simple form: the papers being read (last read in first), then the newest
// unread papers that have a PDF to open. Ranking by searches and chats comes later.
export function upNext(papers: Record<string, Paper>): PaperGroup[] {
  const all = Object.values(papers)
  const reading = all.filter((p) => p.status === "reading").sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
  const unread = all
    .filter((p) => p.status === "unread" && p.pdf)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, UNREAD)
  return [
    { label: t({ message: "Reading", comment: "group heading: papers being read now" }), papers: reading },
    { label: t`Not read yet`, papers: unread },
  ].filter((g) => g.papers.length > 0)
}
