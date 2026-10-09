import type { PaperKind } from "@owlit/protocol"
import type { Http, RequestOptions } from "../../net/http.ts"
import type { SourceRecord } from "./types.ts"

// OpenAlex: the main source for published work (venue, year, type, open-access links). Asked only by
// DOI or OpenAlex id: its arXiv matching can land on a copy from another server.
export const OPENALEX_HOST = "api.openalex.org"

export async function fetchOpenAlex(
  http: Http,
  by: { doi: string } | { openalex: string },
  keys: { contactEmail?: string; openalexApiKey?: string },
  request: RequestOptions = {},
): Promise<SourceRecord | undefined> {
  const key = "doi" in by ? `doi:${by.doi}` : by.openalex
  const params = new URLSearchParams()
  if (keys.contactEmail) params.set("mailto", keys.contactEmail)
  if (keys.openalexApiKey) params.set("api_key", keys.openalexApiKey)
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
  primary_location?: { source?: { display_name?: string } | null } | null
  best_oa_location?: { pdf_url?: string | null } | null
  locations?: { pdf_url?: string | null }[]
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
  return {
    source: "openalex",
    ids: { openalex: work.id.replace(/^https?:\/\/openalex\.org\//, ""), ...(doi ? { doi } : {}) },
    title: work.title ?? undefined,
    authors: work.authorships?.map((a) => a.author.display_name),
    year: work.publication_year ?? undefined,
    date: work.publication_date ?? undefined,
    venue: work.primary_location?.source?.display_name ?? undefined,
    abstract: work.abstract_inverted_index ? fromInvertedIndex(work.abstract_inverted_index) : undefined,
    kind: kindOf(work.type),
    pdfUrls,
    citationCount: work.cited_by_count,
    raw,
  }
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
