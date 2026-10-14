import { t } from "@lingui/core/macro"
import { MENTION_LINK, shownCollection, type Collection, type CollectionPaper, type CollectionRow, type CollectionSummary } from "@owlit/protocol"
import { citationLabel } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"

// The Library's own record of a row's paper, when the paper is there: by the row's id, an id it had
// before, or a shared DOI or arXiv id (a paper added by hand gets the same id, but one dropped in as a PDF
// may not)
export function libraryPaperOf(row: Pick<CollectionRow, "id" | "paper">, papers: Record<string, Paper>, aliases: Record<string, string>): Paper | undefined {
  const direct = papers[row.id] ?? (aliases[row.id] ? papers[aliases[row.id]] : undefined)
  if (direct) return direct
  const { doi, arxiv } = row.paper.ids
  if (!doi && !arxiv) return undefined
  return Object.values(papers).find((p) => (doi && p.ids.doi?.toLowerCase() === doi.toLowerCase()) || (arxiv && p.ids.arxiv === arxiv))
}

export function useLibraryPaper(row: Pick<CollectionRow, "id" | "paper">) {
  const papers = useLibraryStore((s) => s.papers)
  const aliases = useLibraryStore((s) => s.aliases)
  return libraryPaperOf(row, papers, aliases)
}

// What a paper is, as the user sees it: the Library's record wins (their corrections are in it)
export function paperFacts(row: CollectionRow, library: Paper | undefined): CollectionPaper {
  if (!library) return row.paper
  return { ...row.paper, title: library.title, authors: library.authors, year: library.year, venue: library.venue, abstract: library.abstract ?? row.paper.abstract }
}

// "Chang et al. 2023"
export const citeOf = (p: Pick<CollectionPaper, "authors" | "year">) => citationLabel({ authors: p.authors, year: p.year })

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

// The list's groups: one per project, the most recently changed project first, then the collections that
// belong to none. A list with no projects at all has one group and no label.
export function byProject(list: CollectionSummary[]): { key: string; label?: string; collections: CollectionSummary[] }[] {
  const groups = new Map<string, CollectionSummary[]>()
  for (const c of list) groups.set(c.project, [...(groups.get(c.project) ?? []), c])
  const projects = [...groups.keys()].filter((p) => p)
  if (!projects.length) return list.length ? [{ key: "", collections: list }] : []
  return [
    ...projects.map((p) => ({ key: p, label: p, collections: groups.get(p)! })),
    ...(groups.has("") ? [{ key: "", label: t({ message: "Not in a project", comment: "group of collections that belong to no project folder" }), collections: groups.get("")! }] : []),
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
    const md = `[${l.label.replace(/([\[\]\\])/g, "\\$1")}](${l.uri})`
    out = out.slice(0, at) + md + out.slice(at + l.label.length)
    from = at + md.length
  }
  return out
}

// Which collections hold each Library paper, newest change first: by the row's id, or a shared DOI or
// arXiv id. Rows the user removed don't count.
export function collectionsByPaper(collections: Record<string, Collection>, papers: Record<string, Paper>, aliases: Record<string, string>): Map<string, { id: string; title: string }[]> {
  const out = new Map<string, { id: string; title: string }[]>()
  const ordered = Object.values(collections).sort((a, b) => b.updatedAt - a.updatedAt)
  for (const c of ordered) {
    const shown = shownCollection(c)
    for (const row of shown.rows) {
      const paper = libraryPaperOf(row, papers, aliases)
      if (!paper) continue
      const list = out.get(paper.id) ?? []
      if (!list.some((x) => x.id === c.id)) list.push({ id: c.id, title: shown.title })
      out.set(paper.id, list)
    }
  }
  return out
}

// The collection that holds a paper the Library hasn't got, so a link to the paper can open it there
export function collectionHolding(collections: Record<string, Collection>, paperId: string): Collection | undefined {
  return Object.values(collections)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((c) => c.rows.some((r) => r.id === paperId) && !c.yours.removed[`row:${paperId}`])
}
