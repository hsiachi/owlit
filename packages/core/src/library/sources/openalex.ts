import type { PaperKind } from "@owlit/protocol"
import type { Http, RequestOptions } from "../../net/http.ts"
import type { SourceRecord, Years } from "./types.ts"
import { parseRef } from "../refs.ts"

// OpenAlex: the main source for published work (venue, year, type, open-access links). Asked only by
// DOI or OpenAlex id: its arXiv matching can land on a copy from another server.
export const OPENALEX_HOST = "api.openalex.org"

export async function fetchOpenAlex(
  http: Http,
  by: { doi: string } | { openalex: string },
  keys: Keys,
  request: RequestOptions = {},
): Promise<SourceRecord | undefined> {
  const key = "doi" in by ? `doi:${by.doi}` : by.openalex
  const params = withKeys(new URLSearchParams(), keys)
  const query = params.size ? `?${params}` : ""
  try {
    const raw = await http.text(`https://${OPENALEX_HOST}/works/${encodeURIComponent(key).replace(/%3A/g, ":")}${query}`, request)
    return parseOpenAlex(raw)
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined
    throw error
  }
}

interface Work {
  id: string
  ids?: { doi?: string; openalex?: string }
  title?: string | null
  publication_year?: number | null
  publication_date?: string | null
  type?: string | null
  authorships?: { author: { display_name: string } }[]
  primary_location?: { source?: { display_name?: string; host_organization_name?: string | null } | null } | null
  biblio?: { volume?: string | null; issue?: string | null; first_page?: string | null; last_page?: string | null } | null
  best_oa_location?: { pdf_url?: string | null } | null
  locations?: { pdf_url?: string | null; landing_page_url?: string | null }[]
  abstract_inverted_index?: Record<string, number[]> | null
  cited_by_count?: number
}

export function parseOpenAlex(raw: string): SourceRecord | undefined {
  const work = JSON.parse(raw) as Work
  if (!work?.id) return undefined
  const doi = work.ids?.doi?.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase()
  const pdfUrls = [work.best_oa_location?.pdf_url, ...(work.locations ?? []).map((l) => l.pdf_url)].filter(
    (url, i, all): url is string => !!url && all.indexOf(url) === i,
  )
  // OpenAlex has no arXiv id field, but lists the arXiv copy among the paper's locations. Knowing it files
  // a preprint as arxiv-… (the id an agent or the user would add it by) rather than openalex-…
  const arxiv = (work.locations ?? []).flatMap((l) => [l.landing_page_url, l.pdf_url]).map((url) => (url ? parseRef(url) : undefined)).find((ref) => ref?.kind === "arxiv")?.value
  return {
    source: "openalex",
    ids: { openalex: work.id.replace(/^https?:\/\/openalex\.org\//, ""), ...(doi ? { doi } : {}), ...(arxiv ? { arxiv } : {}) },
    title: work.title ?? undefined,
    authors: work.authorships?.map((a) => a.author.display_name),
    year: work.publication_year ?? undefined,
    date: work.publication_date ?? undefined,
    venue: work.primary_location?.source?.display_name ?? undefined,
    volume: work.biblio?.volume ?? undefined,
    issue: work.biblio?.issue ?? undefined,
    pages: pageRange(work.biblio?.first_page, work.biblio?.last_page),
    publisher: work.primary_location?.source?.host_organization_name ?? undefined,
    abstract: work.abstract_inverted_index ? fromInvertedIndex(work.abstract_inverted_index) : undefined,
    kind: kindOf(work.type),
    pdfUrls,
    citationCount: work.cited_by_count,
    raw,
  }
}

// "633-643"; one page alone when the other is missing or the same (an article number)
function pageRange(first?: string | null, last?: string | null) {
  if (!first) return last ?? undefined
  return last && last !== first ? `${first}-${last}` : first
}

// OpenAlex ships abstracts as word → positions
export function fromInvertedIndex(index: Record<string, number[]>) {
  const words: string[] = []
  for (const [word, positions] of Object.entries(index)) for (const at of positions) words[at] = word
  return words.filter((w) => w !== undefined).join(" ") || undefined
}

function kindOf(type: string | null | undefined): PaperKind | undefined {
  switch (type) {
    case "article":
    case "review":
    case "letter":
      return "article"
    case "conference-paper":
    case "proceedings-article":
      return "conference"
    case "preprint":
    case "posted-content":
      return "preprint"
    case "book":
    case "book-chapter":
    case "monograph":
      return "book"
    case "dissertation":
      return "thesis"
    case undefined:
    case null:
      return undefined
    default:
      return "other"
  }
}

type Keys = { contactEmail?: string; openalexApiKey?: string }

// The account's keys added to a request's parameters
function withKeys(params: URLSearchParams, keys: Keys) {
  if (keys.contactEmail) params.set("mailto", keys.contactEmail)
  if (keys.openalexApiKey) params.set("api_key", keys.openalexApiKey)
  return params
}

// The works endpoint with a filter, a sort and the account's keys
async function listWorks(http: Http, params: URLSearchParams, keys: Keys, request: RequestOptions) {
  withKeys(params, keys)
  const raw = await http.text(`https://${OPENALEX_HOST}/works?${params}`, request)
  const { results, meta } = JSON.parse(raw) as { results?: unknown[]; meta?: { count?: number } }
  return {
    records: (results ?? []).map((work) => parseOpenAlex(JSON.stringify(work))).filter((r): r is SourceRecord => !!r),
    total: meta?.count,
  }
}

// What OpenAlex calls each kind. Without a type a search keeps to papers and books: OpenAlex also holds
// datasets, software and front matter, which crowd the newest results.
const TYPES: Record<NonNullable<WorkFilters["type"]>, string> = {
  article: "article|conference-paper",
  review: "review",
  preprint: "preprint",
  book: "book|book-chapter",
}
const PAPERS = "article|conference-paper|review|preprint|book|book-chapter|dissertation"

export interface WorkFilters {
  years?: Years
  sort?: "relevance" | "citations" | "newest"
  minCitations?: number
  type?: "article" | "review" | "preprint" | "book"
  author?: string
  // OpenAlex source ids (S…), any of them
  sources?: string[]
  openAccess?: boolean
}

function filterOf(filters: WorkFilters, extra: string[] = []) {
  const { years, minCitations, type, author, sources, openAccess } = filters
  const parts = [...extra, `type:${type ? TYPES[type] : PAPERS}`]
  if (years?.from !== undefined && years.to !== undefined) parts.push(`publication_year:${years.from}-${years.to}`)
  else if (years?.from !== undefined) parts.push(`publication_year:>${years.from - 1}`)
  else if (years?.to !== undefined) parts.push(`publication_year:<${years.to + 1}`)
  // Some records carry dates years ahead; newest first would put them on top
  parts.push(`to_publication_date:${new Date().toISOString().slice(0, 10)}`)
  if (minCitations) parts.push(`cited_by_count:>${minCitations - 1}`)
  if (author) parts.push(`raw_author_name.search:${searchText(author.replace(/[,|]/g, " "))}`)
  if (sources?.length) parts.push(`primary_location.source.id:${sources.join("|")}`)
  if (openAccess) parts.push("is_oa:true")
  return parts.join(",")
}

const SORTS = { citations: "cited_by_count:desc", newest: "publication_date:desc" }

// OpenAlex reads ? and * as wildcards and refuses them in its default (stemmed) search with a 400, and
// agents search by titles like "What brings intentions to mind? …"; other punctuation passes
export function searchText(query: string) {
  return query.replace(/[?*]/g, " ").replace(/\s+/g, " ").trim()
}

// Works matching words in their title and abstract (OpenAlex ranks the relevant, and the cited among
// them, first); what an agent's library_search finds before it decides what to add
export async function searchOpenAlex(
  http: Http,
  query: string,
  limit: number,
  filters: WorkFilters,
  keys: Keys,
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; total?: number }> {
  const params = new URLSearchParams({ search: searchText(query), filter: filterOf(filters), "per-page": String(limit) })
  if (filters.sort && filters.sort !== "relevance") params.set("sort", SORTS[filters.sort])
  return listWorks(http, params, keys, request)
}

// A paper's references (the works it cites) or the works citing it, by its OpenAlex id
export async function neighboursOpenAlex(
  http: Http,
  work: string,
  kind: "references" | "cited_by",
  limit: number,
  filters: Pick<WorkFilters, "years" | "sort">,
  keys: Keys,
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; total?: number }> {
  // OpenAlex's cited_by:W lists what W cites; cites:W what cites W
  const params = new URLSearchParams({ filter: filterOf(filters, [`${kind === "references" ? "cited_by" : "cites"}:${work}`]), "per-page": String(limit) })
  if (filters.sort && filters.sort !== "relevance") params.set("sort", SORTS[filters.sort])
  return listWorks(http, params, keys, request)
}

export interface OpenAlexSource {
  id: string
  name: string
  type: string
  issns: string[]
}

// Journals and conferences by name, best match first
export async function findSources(http: Http, name: string, keys: Keys, request: RequestOptions = {}): Promise<OpenAlexSource[]> {
  const params = withKeys(new URLSearchParams({ search: searchText(name), "per-page": "8", select: "id,display_name,type,issn_l,issn" }), keys)
  const raw = await http.text(`https://${OPENALEX_HOST}/sources?${params}`, request)
  const { results } = JSON.parse(raw) as { results?: { id: string; display_name: string; type?: string; issn_l?: string | null; issn?: string[] | null }[] }
  return (results ?? []).map((s) => ({
    id: s.id.replace(/^https?:\/\/openalex\.org\//, ""),
    name: s.display_name,
    type: s.type ?? "",
    issns: [...new Set([s.issn_l, ...(s.issn ?? [])].filter((i): i is string => !!i))],
  }))
}

// How often each work is cited, for many works in one request each way: by OpenAlex id, by DOI. Works
// OpenAlex doesn't know are left out of the answer.
export async function citationCountsOpenAlex(
  http: Http,
  works: { openalex?: string; doi?: string }[],
  keys: Keys,
  request: RequestOptions = {},
): Promise<{ openalex: string; doi?: string; count: number }[]> {
  const byId = works.flatMap((w) => (w.openalex ? [w.openalex] : []))
  const byDoi = works.flatMap((w) => (!w.openalex && w.doi ? [w.doi] : []))
  const found: { openalex: string; doi?: string; count: number }[] = []
  for (const [filter, values] of [["openalex", byId], ["doi", byDoi]] as const) {
    // An OR filter takes 100 values at most; 50 keeps the URL short
    for (let i = 0; i < values.length; i += 50) {
      const chunk = values.slice(i, i + 50)
      const params = withKeys(new URLSearchParams({ filter: `${filter}:${chunk.join("|")}`, select: "id,doi,cited_by_count", "per-page": "50" }), keys)
      const raw = await http.text(`https://${OPENALEX_HOST}/works?${params}`, request)
      const { results } = JSON.parse(raw) as { results?: { id: string; doi?: string | null; cited_by_count?: number }[] }
      for (const work of results ?? []) {
        if (typeof work.cited_by_count !== "number") continue
        const doi = work.doi?.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase()
        found.push({ openalex: work.id.replace(/^https?:\/\/openalex\.org\//, ""), ...(doi ? { doi } : {}), count: work.cited_by_count })
      }
    }
  }
  return found
}
