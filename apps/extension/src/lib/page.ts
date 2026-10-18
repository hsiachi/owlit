import { siteOf } from "./verdict.ts"

// What a page says about the paper it shows: the meta tags publishers and arXiv put in a paper's page for
// Google Scholar (citation_*), Dublin Core's identifier, and a DOI or arXiv id in its address when the
// tags say nothing. Read from the page's <head> as text, so it runs the same in a content script, in the
// background and in a test.

export interface PagePaper {
  doi?: string
  arxiv?: string
  title?: string
  authors: string[]
  year?: number
  venue?: string
  // The PDF the page names, as an absolute address
  pdfUrl?: string
}

// The patterns of packages/core/src/library/refs.ts (DOI, arXiv's new and old ids), copied: the
// extension doesn't import core. Change them with those.
const DOI = /\b(10\.\d{4,9}\/[^\s"<>]+)/i
const ARXIV_NEW = /(?<![\d.])(\d{4}\.\d{4,5})(?:v\d+)?(?![\d])/
const ARXIV_OLD = /(?<![\w-])([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?!\d)/
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") return String.fromCodePoint(name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10))
    return ENTITIES[name.toLowerCase()] ?? whole
  })

// An attribute of one tag, as packages/core/src/library/pdf.ts pdfInHtml reads it
const attr = (tag: string, name: string) => {
  const value = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag)?.slice(2).find((v) => v !== undefined)
  return value === undefined ? undefined : decode(value).trim()
}

// Lowercase, without what a publisher's address or a sentence adds after it
export function cleanDoi(raw: string) {
  return raw
    .replace(/\/(full|abstract|epdf|pdf|summary|meta|references|figures)$/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[.,;:)\]}>'"]+$/, "")
    .toLowerCase()
}

const doiIn = (text: string | undefined) => {
  const found = text ? DOI.exec(decodeURIComponentSafe(text)) : null
  return found ? cleanDoi(found[1]) : undefined
}

function decodeURIComponentSafe(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

// The DOI or arXiv id in a page's address: a publisher's /doi/10.1145/…, doi.org, arXiv's abs, pdf and
// html pages
export function idsInUrl(url: string): { doi?: string; arxiv?: string } {
  let address: URL
  try {
    address = new URL(url)
  } catch {
    return {}
  }
  const host = address.hostname.replace(/^www\./, "").toLowerCase()
  const path = decodeURIComponentSafe(address.pathname)
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
    const rest = path.replace(/^\/(abs|pdf|html|format)\//, "").replace(/\.pdf$/i, "")
    const arxiv = ARXIV_NEW.exec(rest) ?? ARXIV_OLD.exec(rest)
    if (arxiv) return { arxiv: arxiv[1] }
  }
  const doi = doiIn(path)
  if (!doi) return {}
  const arxiv = ARXIV_DOI.exec(doi)
  return arxiv ? { arxiv: arxiv[1] } : { doi }
}

// The page's paper, or undefined when the page names none (no DOI, arXiv id or citation title)
export function paperOfPage(html: string, url: string): PagePaper | undefined {
  const metas = new Map<string, string[]>()
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, "name") ?? attr(tag, "property"))?.toLowerCase()
    const content = attr(tag, "content")
    if (!name || !content) continue
    metas.set(name, [...(metas.get(name) ?? []), content])
  }
  const first = (...names: string[]) => names.map((n) => metas.get(n)?.[0]).find((v) => v)
  const paper: PagePaper = { authors: metas.get("citation_author") ?? metas.get("dc.creator") ?? [] }

  const doi = doiIn(first("citation_doi", "prism.doi", "dc.identifier", "dc.identifier.doi", "bepress_citation_doi"))
  const arxivMeta = first("citation_arxiv_id")
  const arxivId = arxivMeta ? (ARXIV_NEW.exec(arxivMeta) ?? ARXIV_OLD.exec(arxivMeta))?.[1] : undefined
  const fromUrl = idsInUrl(url)
  // arXiv's own DOI is the arXiv paper
  const arxivDoi = doi ? ARXIV_DOI.exec(doi)?.[1] : undefined
  paper.doi = (arxivDoi ? undefined : doi) ?? fromUrl.doi
  paper.arxiv = arxivId ?? arxivDoi ?? fromUrl.arxiv

  paper.title = first("citation_title", "dc.title")
  const date = first("citation_publication_date", "citation_date", "citation_online_date", "dc.date", "prism.publicationdate")
  const year = date ? /\b(1[5-9]\d\d|2\d\d\d)\b/.exec(date)?.[1] : undefined
  if (year) paper.year = Number(year)
  paper.venue = first("citation_journal_title", "citation_conference_title", "citation_inbook_title", "prism.publicationname")
  paper.pdfUrl = pdfIn(html, metas, url)

  if (!paper.doi && !paper.arxiv && !paper.title) return undefined
  for (const key of Object.keys(paper) as (keyof PagePaper)[]) if (paper[key] === undefined) delete paper[key]
  return paper
}

// citation_pdf_url, else a <link rel="alternate" type="application/pdf">, as an absolute http(s) address
function pdfIn(html: string, metas: Map<string, string[]>, page: string) {
  const candidates = [...(metas.get("citation_pdf_url") ?? [])]
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\balternate\b/i.test(attr(tag, "rel") ?? "") && /application\/pdf/i.test(attr(tag, "type") ?? "")) candidates.push(attr(tag, "href") ?? "")
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, page)
      if (/^https?:$/.test(url.protocol)) return url.toString()
    } catch {
      // Not an address
    }
  }
  return undefined
}

// The page's own link to its PDF, for a page without citation_pdf_url: one labelled just "PDF" (or
// "Download PDF"), to a .pdf on the page's own site. APA PsycNet's full-text pages link
// /fulltext/<id>.pdf this way and carry no citation tags.
export function pdfLinkIn(html: string, page: string): string | undefined {
  let base: URL
  try {
    base = new URL(page)
  } catch {
    return undefined
  }
  const site = siteOf(base.hostname)
  for (const link of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const text = decode(link[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
    if (!/^(download\s+)?(article\s+)?pdf$/i.test(text)) continue
    const href = attr(`<a ${link[1]}>`, "href")
    if (!href) continue
    try {
      const url = new URL(href, base)
      if (/^https?:$/.test(url.protocol) && siteOf(url.hostname) === site && /\.pdf$/i.test(url.pathname)) return url.toString()
    } catch {
      // Not an address
    }
  }
  return undefined
}
