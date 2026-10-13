import { t } from "@lingui/core/macro"
import type { LibrarySettings, PaperIds, PaperKind } from "@owlit/protocol"
import type { Http, RequestOptions } from "../net/http.ts"
import { cleanDoi, paperIdOf, parseRef, type Ref } from "./refs.ts"
import { ARXIV_HOST, fetchArxiv } from "./sources/arxiv.ts"
import { CROSSREF_HOST, fetchCrossref, findDoiByTitle, titleKey } from "./sources/crossref.ts"
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
  // Fields every service had wrong, to be cleared from the record: why, in a sentence
  dropped?: Partial<Record<MetadataField, string>>
  // Crossref was asked about the DOI and answered, with a record or with "not registered here"
  crossrefAnswered?: boolean
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
  if (!ref) throw new NotAPaper(t`That doesn't look like a DOI, an arXiv id or a link to a paper.`)
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
  let crossrefAnswered = false
  const crossref = (doi: string) =>
    ask(async () => {
      const record = await fetchCrossref(http, doi, keys, request)
      crossrefAnswered = true
      return record
    })

  if (ref.kind === "arxiv") {
    const [arxiv, s2] = await Promise.all([
      ask(() => fetchArxiv(http, ref.value, request)),
      ask(() => fetchS2(http, { arxiv: ref.value }, s2Key, request)),
    ])
    const doi = publishedDoi(arxiv?.ids.doi ?? s2?.ids.doi)
    if (doi) await Promise.all([ask(() => fetchOpenAlex(http, { doi }, keys, request)), crossref(doi)])
  } else if (ref.kind === "doi") {
    const [openalex, s2] = await Promise.all([
      ask(() => fetchOpenAlex(http, { doi: ref.value }, keys, request)),
      ask(() => fetchS2(http, { doi: ref.value }, s2Key, request)),
      crossref(ref.value),
    ])
    // The arXiv version's abstract is the authors' own; only worth a call when nothing else has one
    const arxivId = s2?.ids.arxiv
    if (arxivId && !openalex?.abstract && !s2?.abstract) await ask(() => fetchArxiv(http, arxivId, request))
  } else if (ref.kind === "s2") {
    const s2 = await ask(() => fetchS2(http, { s2: ref.value }, s2Key, request))
    const doi = publishedDoi(s2?.ids.doi)
    if (doi) await Promise.all([ask(() => fetchOpenAlex(http, { doi }, keys, request)), crossref(doi)])
    else if (s2?.ids.arxiv) await ask(() => fetchArxiv(http, s2.ids.arxiv!, request))
  } else {
    const openalex = await ask(() => fetchOpenAlex(http, { openalex: ref.value }, keys, request))
    const doi = publishedDoi(openalex?.ids.doi)
    if (doi) await Promise.all([ask(() => fetchS2(http, { doi }, s2Key, request)), crossref(doi)])
    // A preprint (OpenAlex found its arXiv copy, and no published DOI): arXiv is its authority
    else if (openalex?.ids.arxiv) {
      const arxivId = openalex.ids.arxiv
      await Promise.all([ask(() => fetchArxiv(http, arxivId, request)), ask(() => fetchS2(http, { arxiv: arxivId }, s2Key, request))])
    }
  }

  if (!records.length) {
    // A service that couldn't be asked may still know it; one that answered "not found" returned nothing
    if (failures.length) throw failures[0]
    throw new NotAPaper(t`No service owlit asks knows that paper.`)
  }
  // Known to one index only (a Semantic Scholar or OpenAlex record with no DOI or arXiv id): such a
  // record is often a stray copy of a published paper (2026-10-10: a review came in twice, once as an
  // S2 record without DOI, year or proper author names). Crossref may know the DOI by its title; then
  // the paper is that DOI's.
  if ((ref.kind === "s2" || ref.kind === "openalex") && !records.some((r) => publishedDoi(r.ids.doi) || r.ids.arxiv)) {
    const known = records.find((r) => r.title)
    const quietly = (error: unknown) => {
      if (signal?.aborted) throw error
      return undefined
    }
    const doi = known?.title ? await findDoiByTitle(http, known.title, { year: known.year, author: known.authors?.[0] }, keys, request).catch(quietly) : undefined
    const published = doi ? await resolve(http, { kind: "doi", value: doi }, keys, request).catch(quietly) : undefined
    if (published) return published
  }
  return { ...merge(ref, records), ...(crossrefAnswered ? { crossrefAnswered } : {}) }
}

// Merges what the services said. Who is trusted for what depends on what the paper is: for a preprint
// arXiv is the authority; for published work OpenAlex knows the venue and year best.
export function merge(ref: Ref, records: SourceRecord[]): Resolution {
  const by = (source: SourceRecord["source"]) => records.find((r) => r.source === source)
  const arxiv = by("arxiv")
  const openalex = by("openalex")
  const s2 = by("s2")
  const crossref = by("crossref")

  const ids: PaperIds = {}
  for (const record of [crossref, s2, openalex, arxiv]) Object.assign(ids, record?.ids)
  if (ref.kind !== "url") Object.assign(ids, { [ref.kind]: ref.value })
  const doi = publishedDoi(ids.doi)
  if (doi) ids.doi = doi
  else delete ids.doi

  const published = !!doi
  const order = {
    text: published ? [openalex, s2, arxiv, crossref] : [arxiv, s2, openalex],
    abstract: [arxiv, s2, openalex, crossref],
    when: published ? [openalex, s2, arxiv, crossref] : [arxiv, s2, openalex],
    stats: [s2, openalex, crossref],
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
  let title = pick("title", order.text) ?? "Untitled"
  // The registered title, or Semantic Scholar's, when it is the same title with its subtitle
  for (const record of [crossref, s2]) {
    const fuller = record?.title ? withSubtitle(title, record.title) : undefined
    if (!fuller) continue
    title = fuller
    fields.title = record!.source
    break
  }
  const dropped: NonNullable<Resolution["dropped"]> = {}
  const abstract = pickAbstract(title, order.abstract, fields, dropped)
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
    abstract,
    kind,
    tldr: pick("tldr", [s2]),
    citationCount: pick("citationCount", order.stats),
    pdfUrls: [...new Set([arxiv, openalex, s2, ...records].flatMap((r) => r?.pdfUrls ?? []).concat(ids.arxiv ? [`https://arxiv.org/pdf/${ids.arxiv}`] : []))],
    fields,
    records,
    ...(Object.keys(dropped).length ? { dropped } : {}),
  }
}

// `full` when it is `short` and then a subtitle (OpenAlex keeps only the part before it): short's own
// wording, then the rest of full's. Undefined otherwise.
export function withSubtitle(short: string, full: string) {
  const want = titleKey(short)
  if (!want || !titleKey(full).startsWith(`${want} `)) return undefined
  // Walk full until it has had as many letters and digits as short has; the rest is the subtitle
  const count = want.replace(/ /g, "").length
  const chars = [...full.normalize("NFKD")]
  let seen = 0
  let at = 0
  while (at < chars.length && seen < count) if (/[\p{L}\p{N}]/u.test(chars[at++])) seen++
  const tail = chars
    .slice(at)
    .join("")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .trim()
    .normalize("NFC")
  if (!/\p{L}/u.test(tail)) return undefined
  const head = short.trim().replace(/\.$/, "")
  return /[?!:]$/.test(head) ? `${head} ${tail}` : `${head}: ${tail}`
}

// The first abstract that is about the paper. One that shares no word with a title of five or more
// telling words belongs to another paper (2026-10-10: OpenAlex gave Fischhoff's "Hindsight !=
// foresight" a cancer study's abstract); with no other to take, the paper goes without.
function pickAbstract(title: string, from: (SourceRecord | undefined)[], fields: Resolution["fields"], dropped: NonNullable<Resolution["dropped"]>) {
  const words = stems(title)
  let wrong: SourceRecord | undefined
  for (const record of from) {
    if (!record?.abstract) continue
    if (words.size >= 5) {
      const own = stems(record.abstract)
      if (![...words].some((w) => own.has(w))) {
        wrong ??= record
        continue
      }
    }
    fields.abstract = record.source
    return record.abstract
  }
  if (wrong) dropped.abstract = `${wrong.source}'s abstract shares no word with the title, so it is another paper's`
  return undefined
}

// Function words, and the words any paper's abstract may use whatever it is about: a cancer study's
// abstract shares "effect" with Fischhoff's title, so it can't count as a sign the two are one paper
const STOP = new Set(
  [
    "about after also among from have into more only other over such than that their them then there these they this those through under upon using when where which while with within without would your what does been",
    "effect effects study studies analysis approach approaches model models based system systems method methods results research data design evaluation towards toward case review role impact understanding exploring investigating framework",
  ]
    .join(" ")
    .split(" "),
)

// Telling words, by their first five letters so "remind" and "reminders" meet
function stems(text: string) {
  return new Set(
    titleKey(text)
      .split(" ")
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.slice(0, 5)),
  )
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
    throw new NotAPaper(t`owlit couldn't open that page to see which paper it is.`)
  }
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"))?.[1]
  const found = meta("citation_doi") ?? meta("dc.identifier") ?? meta("DC.identifier") ?? meta("prism.doi") ?? meta("citation_arxiv_id")
  const ref = found ? parseRef(found.replace(/^(doi|info:doi\/)\s*:?\s*/i, "")) : undefined
  if (!ref || ref.kind === "url") throw new NotAPaper(t`That page doesn't say which paper it is.`)
  return ref
}
