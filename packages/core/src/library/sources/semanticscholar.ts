import type { Http, RequestOptions } from "../../net/http.ts"
import type { SourceRecord } from "./types.ts"

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
  const key = "doi" in by ? `DOI:${by.doi}` : "arxiv" in by ? `ARXIV:${by.arxiv}` : by.s2
  try {
    const raw = await http.text(`https://${S2_HOST}/graph/v1/paper/${encodeURIComponent(key).replace(/%3A/g, ":")}?fields=${FIELDS}`, {
      ...request,
      headers: apiKey ? { "x-api-key": apiKey } : {},
    })
    return parseS2(raw)
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined
    throw error
  }
}

interface S2Paper {
  paperId?: string
  externalIds?: { DOI?: string; ArXiv?: string } | null
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
  const venueType = paper.publicationVenue?.type
  const types = paper.publicationTypes ?? []
  return {
    source: "s2",
    ids: { s2: paper.paperId, ...(doi ? { doi } : {}), ...(arxiv ? { arxiv } : {}) },
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
