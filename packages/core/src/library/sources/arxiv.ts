import type { Http, RequestOptions } from "../../net/http.ts"
import { stripArxivVersion } from "../refs.ts"
import type { SourceRecord } from "./types.ts"

// arXiv's own API (Atom). Authoritative for preprints: title, authors, abstract, first-version date.
// arXiv asks for no more than one request every three seconds.
export const ARXIV_HOST = "export.arxiv.org"

export async function fetchArxiv(http: Http, id: string, request: RequestOptions = {}): Promise<SourceRecord | undefined> {
  const raw = await http.text(`https://${ARXIV_HOST}/api/query?id_list=${encodeURIComponent(stripArxivVersion(id))}`, request)
  return parseArxiv(raw)
}

export function parseArxiv(raw: string): SourceRecord | undefined {
  const entry = raw.match(/<entry>([\s\S]*?)<\/entry>/)?.[1]
  if (!entry) return undefined
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
