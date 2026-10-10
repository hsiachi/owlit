import type { LibrarySettings, PaperIds, PaperKind } from "@owlit/protocol"
import type { Http, RequestOptions } from "../net/http.ts"
import { cleanDoi, paperIdOf, parseRef, type Ref } from "./refs.ts"
import { ARXIV_HOST, fetchArxiv } from "./sources/arxiv.ts"
import { CROSSREF_HOST } from "./sources/crossref.ts"
import { fetchOpenAlex, OPENALEX_HOST } from "./sources/openalex.ts"
import { fetchS2, S2_HOST } from "./sources/semanticscholar.ts"
import type { SourceRecord } from "./sources/types.ts"

export type MetadataField = "title" | "authors" | "year" | "date" | "venue" | "abstract" | "kind" | "tldr" | "citationCount"

export interface Resolution {
  // The paper's id in the library (refs.paperIdOf)
  id: string
  ids: PaperIds
  title: string
  authors: string[]
  year?: number
  date?: string
  venue?: string
  abstract?: string
  kind?: PaperKind
  tldr?: string
  citationCount?: number
  // Open-access PDF links, best first
  pdfUrls: string[]
  // Which service each field came from
  fields: Partial<Record<MetadataField, SourceRecord["source"]>>
  // What each service answered, to keep beside the paper
  records: SourceRecord[]
}

export type MetadataKeys = Pick<LibrarySettings, "contactEmail" | "openalexApiKey" | "s2ApiKey">

// Rates the services ask for
export function limitMetadataHosts(http: Http, keys: MetadataKeys = {}) {
  http.limit(ARXIV_HOST, { perSecond: 1 / 3, concurrent: 1 })
  http.limit(OPENALEX_HOST, { perSecond: 8, concurrent: 4 })
  http.limit(S2_HOST, keys.s2ApiKey ? { perSecond: 1, concurrent: 1 } : { perSecond: 0.5, concurrent: 1 })
  http.limit(CROSSREF_HOST, { perSecond: 5, concurrent: 1 })
}

// No service knows the paper, or what was given isn't a reference
export class NotAPaper extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NotAPaper"
  }
}

// What a reference means: asks the services that can answer for it and merges their answers field by
// field. Writes nothing.
export async function resolve(http: Http, input: string | Ref, keys: MetadataKeys = {}, request: RequestOptions = {}): Promise<Resolution> {
  const { signal } = request
  const ref = typeof input === "string" ? parseRef(input) : input
  if (!ref) throw new NotAPaper("That doesn't look like a DOI, an arXiv id or a link to a paper.")
  if (ref.kind === "url") return resolve(http, await refFromPage(http, ref.value, signal), keys, request)

  const records: SourceRecord[] = []
  const failures: unknown[] = []
  // A service that fails doesn't stop the others; the merge works with what came back
  const ask = async (request: () => Promise<SourceRecord | undefined>) => {
    try {
      const record = await request()
      if (record) records.push(record)
      return record
    } catch (error) {
      if (signal?.aborted) throw error
      failures.push(error)
      return undefined
    }
  }
  const s2Key = keys.s2ApiKey

  if (ref.kind === "arxiv") {
    const [arxiv, s2] = await Promise.all([
      ask(() => fetchArxiv(http, ref.value, request)),
      ask(() => fetchS2(http, { arxiv: ref.value }, s2Key, request)),
    ])
    const doi = publishedDoi(arxiv?.ids.doi ?? s2?.ids.doi)
    if (doi) await ask(() => fetchOpenAlex(http, { doi }, keys, request))
  } else if (ref.kind === "doi") {
    const [openalex, s2] = await Promise.all([
      ask(() => fetchOpenAlex(http, { doi: ref.value }, keys, request)),
      ask(() => fetchS2(http, { doi: ref.value }, s2Key, request)),
    ])
    // The arXiv version's abstract is the authors' own; only worth a call when nothing else has one
    const arxivId = s2?.ids.arxiv
    if (arxivId && !openalex?.abstract && !s2?.abstract) await ask(() => fetchArxiv(http, arxivId, request))
  } else if (ref.kind === "s2") {
    const s2 = await ask(() => fetchS2(http, { s2: ref.value }, s2Key, request))
    if (s2?.ids.doi) await ask(() => fetchOpenAlex(http, { doi: s2.ids.doi! }, keys, request))
    else if (s2?.ids.arxiv) await ask(() => fetchArxiv(http, s2.ids.arxiv!, request))
  } else {
    const openalex = await ask(() => fetchOpenAlex(http, { openalex: ref.value }, keys, request))
    if (openalex?.ids.doi) await ask(() => fetchS2(http, { doi: openalex.ids.doi! }, s2Key, request))
    // A preprint (OpenAlex found its arXiv copy, and no published DOI): arXiv is its authority
    else if (openalex?.ids.arxiv) {
      const arxivId = openalex.ids.arxiv
      await Promise.all([ask(() => fetchArxiv(http, arxivId, request)), ask(() => fetchS2(http, { arxiv: arxivId }, s2Key, request))])
    }
  }

  if (!records.length) {
    // A service that couldn't be asked may still know it; one that answered "not found" returned nothing
    if (failures.length) throw failures[0]
    throw new NotAPaper("No service owlit asks knows that paper.")
  }
  return merge(ref, records)
}

// Merges what the services said. Who is trusted for what depends on what the paper is: for a preprint
// arXiv is the authority; for published work OpenAlex knows the venue and year best.
export function merge(ref: Ref, records: SourceRecord[]): Resolution {
  const by = (source: SourceRecord["source"]) => records.find((r) => r.source === source)
  const arxiv = by("arxiv")
  const openalex = by("openalex")
  const s2 = by("s2")

  const ids: PaperIds = {}
  for (const record of [s2, openalex, arxiv]) Object.assign(ids, record?.ids)
  if (ref.kind !== "url") Object.assign(ids, { [ref.kind]: ref.value })
  const doi = publishedDoi(ids.doi)
  if (doi) ids.doi = doi
  else delete ids.doi

  const published = !!doi
  const order = {
    text: published ? [openalex, s2, arxiv] : [arxiv, s2, openalex],
    abstract: [arxiv, s2, openalex],
    when: published ? [openalex, s2, arxiv] : [arxiv, s2, openalex],
    stats: [s2, openalex],
  }
  const fields: Resolution["fields"] = {}
  const pick = <K extends MetadataField>(field: K, from: (SourceRecord | undefined)[]) => {
    for (const record of from) {
      const value = record?.[field]
      if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) continue
      fields[field] = record!.source
      return value as SourceRecord[K]
    }
    return undefined
  }

  const id = paperIdOf(ids)!
  const title = pick("title", order.text) ?? "Untitled"
  const kind = published ? pick("kind", [openalex, s2]) : "preprint"
  if (!published) fields.kind = arxiv ? "arxiv" : records[0].source
  return {
    id,
    ids,
    title,
    authors: pick("authors", order.text) ?? [],
    year: pick("year", order.when),
    date: pick("date", order.when),
    venue: published ? pick("venue", order.when) : (arxiv?.venue ?? undefined),
    abstract: pick("abstract", order.abstract),
    kind,
    tldr: pick("tldr", [s2]),
    citationCount: pick("citationCount", order.stats),
    pdfUrls: [...new Set([arxiv, openalex, s2, ...records].flatMap((r) => r?.pdfUrls ?? []).concat(ids.arxiv ? [`https://arxiv.org/pdf/${ids.arxiv}`] : []))],
    fields,
    records,
  }
}

// A DOI that names the published work, not arXiv's own DataCite DOI
function publishedDoi(doi: string | undefined) {
  if (!doi) return undefined
  const clean = cleanDoi(doi)
  return /^10\.48550\/arxiv\./i.test(clean) ? undefined : clean
}

// A publisher's page names its paper in <meta> tags (citation_doi, dc.identifier, citation_arxiv_id)
async function refFromPage(http: Http, url: string, signal?: AbortSignal): Promise<Ref> {
  let html: string
  try {
    html = (await http.text(url, { signal, retries: 1, headers: { accept: "text/html" } })).slice(0, 400_000)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new NotAPaper("owlit couldn't open that page to see which paper it is.")
  }
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"))?.[1]
  const found = meta("citation_doi") ?? meta("dc.identifier") ?? meta("DC.identifier") ?? meta("prism.doi") ?? meta("citation_arxiv_id")
  const ref = found ? parseRef(found.replace(/^(doi|info:doi\/)\s*:?\s*/i, "")) : undefined
  if (!ref || ref.kind === "url") throw new NotAPaper("That page doesn't say which paper it is.")
  return ref
}
