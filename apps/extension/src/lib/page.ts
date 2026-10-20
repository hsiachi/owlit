import { siteOf } from "./verdict.ts"

// What a page says about the paper it shows: the meta tags publishers and arXiv put in a paper's page for
// Google Scholar (citation_*), Dublin Core's identifier, schema.org's ScholarlyArticle in JSON-LD, IEEE
// Xplore's metadata script, an og:title beside a DOI the page links, and a DOI or arXiv id in its address
// when nothing else says. Read from the page's markup as text (paperMarkup), so it runs the same in a
// content script, in the background and in a test.

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

// What of a page is read for its paper: its <head>, and the scripts in its body that describe the paper
// (JSON-LD, IEEE Xplore's metadata). Nothing else of the page leaves it. Self-contained, since
// scripting.executeScript runs it in the tab by its source.
export function paperMarkup(): string {
  const parts = [document.head?.outerHTML ?? ""]
  for (const script of Array.from(document.querySelectorAll("body script"))) {
    const text = script.textContent ?? ""
    if (script.getAttribute("type") === "application/ld+json" || text.includes("xplGlobal.document.metadata")) parts.push(script.outerHTML.slice(0, 200_000))
  }
  return parts.join("\n")
}

// A page that lists papers rather than showing one, by its site's name: pressing the button there says
// so plainly, instead of "doesn't show a paper"
export function listingOf(url: string): string | undefined {
  try {
    const { hostname, pathname } = new URL(url)
    if (/(^|\.)scholar\.google\.[a-z.]+$/i.test(hostname) && !/\/citations/.test(pathname)) return "Google Scholar"
  } catch {
    // Not an address
  }
  return undefined
}

// An address that reads as a PDF's (…/x.pdf, …/pdf/…): all that says a tab shows one where the extension
// saw no response (a site it may not read) and can run no script (the browser's PDF viewer)
export function namesPdf(url: string): boolean {
  try {
    return /\.pdf$|\/pdf\//i.test(new URL(url).pathname)
  } catch {
    return false
  }
}

// The page's paper, or undefined when the page names none (no DOI, arXiv id or title from a paper's
// metadata), or lists papers (listingOf)
export function paperOfPage(html: string, url: string): PagePaper | undefined {
  if (listingOf(url)) return undefined
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

  // Pages without citation tags: what their metadata scripts say, under what the tags said
  const more = ieeeOf(html, url) ?? scholarlyArticleOf(html)
  if (more) {
    paper.doi ??= more.doi
    paper.title ??= more.title
    if (!paper.authors.length) paper.authors = more.authors
    paper.year ??= more.year
    paper.venue ??= more.venue
    paper.pdfUrl ??= more.pdfUrl
  }
  // A page that only has an og:title is a paper's when it links one DOI (doi.org) as well: an article on a
  // site that puts no citation tags in its head. A news or blog piece about a study links that study's
  // DOI under its own headline, and one linking several DOIs cites them: neither is the paper.
  if (!paper.title && !paper.arxiv && !isNewsPiece(html, metas)) {
    const linked = new Set([...html.matchAll(/https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/[^\s"'<>]+)/gi)].map((m) => doiIn(m[1])).filter(Boolean))
    if (!paper.doi && linked.size === 1) paper.doi = [...linked][0]
    if (paper.doi) paper.title = first("og:title", "twitter:title")
  }

  if (!paper.doi && !paper.arxiv && !paper.title) return undefined
  for (const key of Object.keys(paper) as (keyof PagePaper)[]) if (paper[key] === undefined) delete paper[key]
  return paper
}

// A news or blog piece, as it says of itself: a JSON-LD NewsArticle or BlogPosting, or an Open Graph
// article in a section (news sites name theirs)
function isNewsPiece(html: string, metas: Map<string, string[]>) {
  if (/"@type"\s*:\s*(?:\[[^\]]*)?"(?:NewsArticle|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|LiveBlogPosting)"/.test(html)) return true
  return metas.get("og:type")?.[0]?.toLowerCase() === "article" && metas.has("article:section")
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

type More = Omit<PagePaper, "arxiv">

// schema.org's ScholarlyArticle (or one of its kinds) in the page's JSON-LD, anywhere in a graph
function scholarlyArticleOf(html: string): More | undefined {
  for (const block of html.matchAll(/<script\b[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(block[1])
    } catch {
      continue
    }
    const found = findArticle(data)
    if (!found) continue
    const name = (value: unknown) => (typeof value === "string" ? value : value && typeof value === "object" && "name" in value && typeof value.name === "string" ? value.name : undefined)
    const list = (value: unknown) => (Array.isArray(value) ? value : value ? [value] : [])
    const ids = [found.doi, found.identifier, found.sameAs, found.url, found["@id"]].flatMap(list).map((v) => (typeof v === "string" ? v : name(v) ?? (v && typeof v === "object" && "value" in v ? String(v.value) : "")))
    const date = [found.datePublished, found.dateCreated].find((v) => typeof v === "string") as string | undefined
    const year = date ? /\b(1[5-9]\d\d|2\d\d\d)\b/.exec(date)?.[1] : undefined
    const venue = name(found.isPartOf) ?? name(found.publisher)
    const title = name(found.headline) ?? name(found.name)
    return {
      doi: ids.map((id) => doiIn(id)).find(Boolean),
      title: title && decode(title).trim(),
      authors: list(found.author).map(name).filter((n): n is string => !!n),
      year: year ? Number(year) : undefined,
      venue,
    }
  }
  return undefined
}

const ARTICLE_TYPES = /^(ScholarlyArticle|Article|MedicalScholarlyArticle|Report|Thesis|Chapter)$/
function findArticle(data: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!data || typeof data !== "object" || depth > 4) return undefined
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findArticle(item, depth + 1)
      if (found) return found
    }
    return undefined
  }
  const record = data as Record<string, unknown>
  const types = (Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]]).map(String)
  if (types.some((type) => ARTICLE_TYPES.test(type))) return record
  return findArticle(record["@graph"], depth + 1) ?? findArticle(record.mainEntity, depth + 1)
}

// IEEE Xplore's article page (/document/<number>) puts no citation tags in its head: its metadata is a
// script, xplGlobal.document.metadata = {…};
function ieeeOf(html: string, url: string): More | undefined {
  let number: string | undefined
  try {
    const address = new URL(url)
    if (!/(^|\.)ieeexplore\.ieee\.org$/i.test(address.hostname)) return undefined
    number = /^\/(?:abstract\/)?document\/(\d+)/.exec(address.pathname)?.[1]
  } catch {
    return undefined
  }
  if (!number) return undefined
  const at = html.indexOf("xplGlobal.document.metadata")
  const json = at < 0 ? undefined : objectAt(html, html.indexOf("{", at))
  let data: Record<string, unknown> = {}
  try {
    data = json ? JSON.parse(json) : {}
  } catch {
    // Unreadable: the number alone still names the PDF
  }
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? decode(value).trim() : undefined)
  const authors = Array.isArray(data.authors) ? data.authors.map((a) => text((a as { name?: unknown })?.name)).filter((n): n is string => !!n) : []
  const year = text(data.publicationYear)
  return {
    doi: doiIn(text(data.doi)),
    title: text(data.title) ?? text(data.formulaStrippedArticleTitle),
    authors,
    year: year && /^\d{4}$/.test(year) ? Number(year) : undefined,
    venue: text(data.publicationTitle),
    // The PDF itself; stamp.jsp, which the page links, is a frame around it
    pdfUrl: `https://ieeexplore.ieee.org/stampPDF/getPDF.jsp?tp=&arnumber=${number}`,
  }
}

// The JSON object starting at a brace, up to its matching one, strings skipped
function objectAt(text: string, start: number): string | undefined {
  if (start < 0) return undefined
  let depth = 0
  let quoted = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === "\\") i++
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return text.slice(start, i + 1)
  }
  return undefined
}
