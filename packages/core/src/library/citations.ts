import type { PaperIds, PaperRecord } from "@owlit/protocol"
import type { Http, RequestOptions } from "../net/http.ts"
import type { MetadataKeys } from "./resolve.ts"
import { citationCountsOpenAlex } from "./sources/openalex.ts"
import { citationCountsS2 } from "./sources/semanticscholar.ts"

// Citation counts grow, so a paper's is counted again once it is a month old. Every paper is counted
// by OpenAlex when OpenAlex knows it, so the library's counts compare with each other; Semantic Scholar
// counts the rest (mostly arXiv preprints, which OpenAlex isn't asked about).

export const CITATIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Whether the paper's count is due: a record the services wrote, never counted since counts were kept
// current, or counted over a month ago. A record written by hand or by another program is left as it is.
export function citationsDue(record: PaperRecord, now = Date.now()): boolean {
  if (!record.fetchedAt) return false
  const { doi, openalex, arxiv, s2 } = record.ids
  if (!doi && !openalex && !arxiv && !s2) return false
  return !record.citationsAt || now - record.citationsAt > CITATIONS_TTL_MS
}

export interface Counted {
  count: number
  source: "openalex" | "s2"
}

// The count of each paper a service knows, by the paper's id; papers neither service knows are left out
export async function countCitations(
  http: Http,
  papers: { id: string; ids: PaperIds }[],
  keys: MetadataKeys,
  request: RequestOptions = {},
): Promise<Map<string, Counted>> {
  const counted = new Map<string, Counted>()
  const asked = papers.filter((p) => p.ids.openalex || p.ids.doi)
  if (asked.length) {
    const found = await citationCountsOpenAlex(http, asked.map((p) => ({ openalex: p.ids.openalex, doi: p.ids.doi })), keys, request)
    const byId = new Map(found.map((f) => [f.openalex, f.count]))
    const byDoi = new Map(found.flatMap((f) => (f.doi ? [[f.doi, f.count] as const] : [])))
    for (const p of asked) {
      const count = (p.ids.openalex ? byId.get(p.ids.openalex) : undefined) ?? (p.ids.doi ? byDoi.get(p.ids.doi.toLowerCase()) : undefined)
      if (typeof count === "number") counted.set(p.id, { count, source: "openalex" })
    }
  }
  const rest = papers.flatMap((p) => {
    if (counted.has(p.id)) return []
    const key = p.ids.s2 ?? (p.ids.doi ? `DOI:${p.ids.doi}` : p.ids.arxiv ? `ARXIV:${p.ids.arxiv}` : undefined)
    return key ? [{ id: p.id, key }] : []
  })
  if (rest.length) {
    const counts = await citationCountsS2(http, rest.map((r) => r.key), keys.s2ApiKey, request)
    rest.forEach((r, i) => {
      const count = counts[i]
      if (typeof count === "number") counted.set(r.id, { count, source: "s2" })
    })
  }
  return counted
}
