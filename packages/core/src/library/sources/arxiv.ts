import type { Http, RequestOptions } from "../../net/http.ts"
import { stripArxivVersion } from "../refs.ts"
import type { SourceRecord, Years } from "./types.ts"

// arXiv's own API (Atom). Authoritative for preprints: title, authors, abstract, first-version date.
// arXiv asks for no more than one request every three seconds.
export const ARXIV_HOST = "export.arxiv.org"

export async function fetchArxiv(http: Http, id: string, request: RequestOptions = {}): Promise<SourceRecord | undefined> {
  const raw = await http.text(`https://${ARXIV_HOST}/api/query?id_list=${encodeURIComponent(stripArxivVersion(id))}`, request)
  return parseArxiv(raw)
}

export function parseArxiv(raw: string): SourceRecord | undefined {
  const entry = raw.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  return entry ? parseEntry(entry, raw) : undefined
}

// Bare words are all required, anywhere in a paper; a query with ':' is arXiv's own syntax
// (cat:cs.CL AND au:Manning ANDNOT ti:survey) and is passed on as it is
export async function searchArxiv(
  http: Http,
  query: string,
  limit: number,
  filters: { years?: Years; author?: string; newest?: boolean },
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; total?: number }> {
  const terms = query.includes(":") ? [`(${query})`] : query.split(/\s+/).filter(Boolean).map((w) => `all:${w.replace(/[()"]/g, "")}`)
  if (filters.author) terms.push(`au:"${filters.author.replace(/"/g, "")}"`)
  const { years } = filters
  if (years) terms.push(`submittedDate:[${years.from ?? 1991}01010000 TO ${years.to ?? 9999}12312359]`)
  const params = new URLSearchParams({ search_query: terms.join(" AND "), start: "0", max_results: String(limit) })
  if (filters.newest) {
    params.set("sortBy", "submittedDate")
    params.set("sortOrder", "descending")
  }
  const raw = await http.text(`https://${ARXIV_HOST}/api/query?${params}`, request)
  const total = Number(raw.match(/<opensearch:totalResults[^>]*>(\d+)</)?.[1])
  const records = [...raw.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => parseEntry(m[1], m[0])).filter((r): r is SourceRecord => !!r)
  return { records, total: Number.isFinite(total) ? total : undefined }
}

function parseEntry(entry: string, raw: string): SourceRecord | undefined {
  const idUrl = text(entry, "id")
  const id = idUrl?.match(/arxiv\.org\/abs\/(.+?)(v\d+)?$/)?.[1]
  // An unknown id comes back as an entry titled "Error"
  if (!id || text(entry, "title") === "Error") return undefined
  const published = text(entry, "published")
  const doi = text(entry, "arxiv:doi")
  const journal = text(entry, "arxiv:journal_ref")
  return {
    source: "arxiv",
    ids: { arxiv: id, ...(doi ? { doi: doi.toLowerCase() } : {}) },
    title: squash(text(entry, "title")),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => squash(decode(m[1]))!),
    year: published ? Number(published.slice(0, 4)) : undefined,
    date: published?.slice(0, 10),
    venue: journal ? squash(journal) : undefined,
    abstract: squash(text(entry, "summary")),
    kind: "preprint",
    pdfUrls: [`https://arxiv.org/pdf/${id}`],
    raw,
  }
}

function text(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return match ? decode(match[1]).trim() : undefined
}

const squash = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() || undefined

function decode(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
}
