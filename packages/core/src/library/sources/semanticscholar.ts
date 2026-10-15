import type { Http, RequestOptions } from "../../net/http.ts"
import type { SourceRecord, Years } from "./types.ts"

// Semantic Scholar: links between ids (an arXiv paper's published DOI), the tldr and the citation
// count. Without a key it allows about one request a second, shared with everyone, so 429 is common.
export const S2_HOST = "api.semanticscholar.org"

const FIELDS = "title,authors,year,venue,publicationVenue,publicationDate,abstract,externalIds,tldr,citationCount,openAccessPdf,publicationTypes"

export async function fetchS2(
  http: Http,
  by: { doi: string } | { arxiv: string } | { s2: string },
  apiKey: string | undefined,
  request: RequestOptions = {},
): Promise<SourceRecord | undefined> {
  const key = s2Key(by)!
  try {
    const raw = await http.text(`https://${S2_HOST}/graph/v1/paper/${encodeURIComponent(key).replace(/%3A/g, ":")}?fields=${FIELDS}`, {
      ...request,
      headers: { ...request.headers, ...headersFor(apiKey) },
    })
    return parseS2(raw)
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined
    throw error
  }
}

interface S2Paper {
  paperId?: string
  externalIds?: { DOI?: string; ArXiv?: string; ACL?: string } | null
  title?: string | null
  authors?: { name: string }[]
  year?: number | null
  publicationDate?: string | null
  venue?: string | null
  publicationVenue?: { name?: string; type?: string } | null
  abstract?: string | null
  tldr?: { text?: string } | null
  citationCount?: number | null
  openAccessPdf?: { url?: string | null } | null
  publicationTypes?: string[] | null
}

export function parseS2(raw: string): SourceRecord | undefined {
  const paper = JSON.parse(raw) as S2Paper
  if (!paper?.paperId) return undefined
  const doi = paper.externalIds?.DOI?.toLowerCase()
  const arxiv = paper.externalIds?.ArXiv
  const acl = paper.externalIds?.ACL
  const venueType = paper.publicationVenue?.type
  const types = paper.publicationTypes ?? []
  return {
    source: "s2",
    ids: { s2: paper.paperId, ...(doi ? { doi } : {}), ...(arxiv ? { arxiv } : {}), ...(acl ? { acl } : {}) },
    title: paper.title ?? undefined,
    authors: paper.authors?.map((a) => a.name),
    year: paper.year ?? undefined,
    date: paper.publicationDate ?? undefined,
    venue: paper.publicationVenue?.name || paper.venue || undefined,
    abstract: paper.abstract ?? undefined,
    kind:
      venueType === "conference" || types.includes("Conference")
        ? "conference"
        : venueType === "journal" || types.includes("JournalArticle")
          ? "article"
          : undefined,
    pdfUrls: paper.openAccessPdf?.url ? [paper.openAccessPdf.url] : [],
    tldr: paper.tldr?.text ?? undefined,
    citationCount: paper.citationCount ?? undefined,
    raw,
  }
}

type S2Key = string | undefined
const headersFor = (apiKey: S2Key): Record<string, string> => (apiKey ? { "x-api-key": apiKey } : {})
const LIST_FIELDS = "title,authors,year,venue,publicationVenue,publicationDate,externalIds,tldr,citationCount,openAccessPdf,publicationTypes,abstract"
// References, citations and recommendations don't carry the tldr (they answer 400 when asked for it)
const NEIGHBOUR_FIELDS = LIST_FIELDS.replace("tldr,", "")

const records = (papers: (S2Paper | null | undefined)[]) =>
  papers.map((p) => (p ? parseS2(JSON.stringify(p)) : undefined)).filter((r): r is SourceRecord => !!r)

// S2 says how many it has, and only ranks by relevance
export async function searchS2(
  http: Http,
  query: string,
  limit: number,
  filters: { years?: Years; minCitations?: number; types?: string[]; venue?: string; openAccess?: boolean },
  apiKey: S2Key,
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; total?: number }> {
  const params = new URLSearchParams({ query, limit: String(limit), fields: LIST_FIELDS })
  const { years, minCitations, types, venue, openAccess } = filters
  if (years) params.set("year", `${years.from ?? ""}-${years.to ?? ""}`)
  if (minCitations) params.set("minCitationCount", String(minCitations))
  if (types?.length) params.set("publicationTypes", types.join(","))
  if (venue) params.set("venue", venue)
  if (openAccess) params.set("openAccessPdf", "")
  const raw = await http.text(`https://${S2_HOST}/graph/v1/paper/search?${params}`, { ...request, headers: headersFor(apiKey) })
  const { data, total } = JSON.parse(raw) as { data?: S2Paper[]; total?: number }
  return { records: records(data ?? []), total }
}

// How S2's paper endpoints want an id spelled
export function s2Key(ids: { doi?: string; arxiv?: string; s2?: string }) {
  return ids.s2 ?? (ids.doi ? `DOI:${ids.doi}` : ids.arxiv ? `ARXIV:${ids.arxiv}` : undefined)
}

// What a paper cites, or what cites it: the first 1000, in no particular order (S2 neither sorts nor
// filters these), so the caller sorts and filters the page; more says there were others past it
export async function neighboursS2(
  http: Http,
  paper: string,
  kind: "references" | "cited_by",
  apiKey: S2Key,
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; more: boolean }> {
  const path = kind === "references" ? "references" : "citations"
  const raw = await http.text(`https://${S2_HOST}/graph/v1/paper/${encodeURIComponent(paper).replace(/%3A/g, ":")}/${path}?limit=1000&fields=${NEIGHBOUR_FIELDS}`, {
    ...request,
    headers: headersFor(apiKey),
  })
  const { data, next } = JSON.parse(raw) as { data?: { citedPaper?: S2Paper; citingPaper?: S2Paper }[]; next?: number }
  return { records: records((data ?? []).map((d) => d.citedPaper ?? d.citingPaper)), more: next !== undefined }
}

// Papers like this one, from S2's recommender over computer science
export async function similarS2(http: Http, paper: string, limit: number, apiKey: S2Key, request: RequestOptions = {}): Promise<SourceRecord[]> {
  const raw = await http.text(
    `https://${S2_HOST}/recommendations/v1/papers/forpaper/${encodeURIComponent(paper).replace(/%3A/g, ":")}?from=all-cs&limit=${limit}&fields=${NEIGHBOUR_FIELDS}`,
    { ...request, headers: headersFor(apiKey) },
  )
  const { recommendedPapers } = JSON.parse(raw) as { recommendedPapers?: S2Paper[] }
  return records(recommendedPapers ?? [])
}

// How often each paper is cited, for up to 500 papers a request; null where Semantic Scholar doesn't
// know the paper. Ids as fetchS2 takes them: DOI:…, ARXIV:… or a paperId.
export async function citationCountsS2(http: Http, ids: string[], apiKey: S2Key, request: RequestOptions = {}): Promise<(number | null)[]> {
  const counts: (number | null)[] = []
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const raw = await http.text(`https://${S2_HOST}/graph/v1/paper/batch?fields=citationCount`, {
      ...request,
      method: "POST",
      body: JSON.stringify({ ids: chunk }),
      headers: { ...request.headers, ...headersFor(apiKey), "content-type": "application/json" },
      // Only reads, so a passing failure is tried again as a GET would be
      retries: request.retries ?? 3,
    })
    const papers = JSON.parse(raw) as ({ citationCount?: number | null } | null)[]
    counts.push(...chunk.map((_, j) => (typeof papers[j]?.citationCount === "number" ? papers[j]!.citationCount! : null)))
  }
  return counts
}
