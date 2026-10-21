import type { Http, RequestOptions } from "../../net/http.ts"
import type { SourceRecord, Years } from "./types.ts"
import { decodeEntities, squash } from "../html-text.ts"

// Crossref: what a publisher registered. For a journal it is the full list, since every article gets
// its DOI there, so it answers "everything this journal published in 2024" where a search index can
// only guess. Abstracts are there when the publisher deposits them (Elsevier doesn't).
export const CROSSREF_HOST = "api.crossref.org"

// A journal year over this many articles is a mega-journal; going through it isn't what the tool is for
export const MAX_JOURNAL_ARTICLES = 5000

export interface JournalArticle {
  doi: string
  title: string
  authors: string[]
  year?: number
  date?: string
  journal?: string
  volume?: string
  issue?: string
  page?: string
  publisher?: string
  abstract?: string
  citationCount?: number
}

interface Work {
  DOI: string
  title?: string[]
  author?: { given?: string; family?: string; name?: string }[]
  issued?: { "date-parts"?: (number | null)[][] }
  "container-title"?: string[]
  volume?: string
  issue?: string
  page?: string
  // PACM and other article-numbered journals: "14", where page is "1-22" or absent
  "article-number"?: string
  publisher?: string
  abstract?: string
  "is-referenced-by-count"?: number
}

export class TooManyArticles extends Error {
  readonly total: number
  constructor(total: number) {
    super(`${total} articles`)
    this.total = total
    this.name = "TooManyArticles"
  }
}

// Every research article (not editorials or errata) the journal published in the years: first
// publication, online or in print, decides the year. Comes back in issue order.
export async function journalArticles(
  http: Http,
  issn: string,
  years: Required<Years>,
  keys: { contactEmail?: string },
  request: RequestOptions = {},
): Promise<JournalArticle[]> {
  const works: Work[] = []
  let cursor = "*"
  for (;;) {
    const params = new URLSearchParams({
      filter: `from-pub-date:${years.from}-01-01,until-pub-date:${years.to}-12-31,type:journal-article`,
      rows: "1000",
      cursor,
      select: "DOI,title,author,issued,container-title,volume,issue,page,publisher,abstract,is-referenced-by-count",
    })
    if (keys.contactEmail) params.set("mailto", keys.contactEmail)
    const raw = await http.text(`https://${CROSSREF_HOST}/journals/${encodeURIComponent(issn)}/works?${params}`, request)
    const { message } = JSON.parse(raw) as { message: { items: Work[]; "total-results": number; "next-cursor"?: string } }
    if (message["total-results"] > MAX_JOURNAL_ARTICLES) throw new TooManyArticles(message["total-results"])
    works.push(...message.items)
    if (!message.items.length || works.length >= message["total-results"] || !message["next-cursor"]) break
    cursor = message["next-cursor"]
  }
  return works
    .map(parseWork)
    .filter((a) => !FRONT_MATTER.test(a.title))
    .sort(issueOrder)
}

// Pages publishers register as articles though nobody would cite them
const FRONT_MATTER = /^(editorial board|issue information|table of contents|contents|masthead|cover|front matter|back matter|publisher'?s note|title page|reviewers?( list)?|thanks to (our )?reviewers)$/i

function parseWork(work: Work): JournalArticle {
  const parts = work.issued?.["date-parts"]?.[0] ?? []
  const [year, month, day] = parts.filter((n): n is number => typeof n === "number")
  return {
    doi: work.DOI.toLowerCase(),
    title: plainTitle(work.title?.[0]) ?? "Untitled",
    authors: (work.author ?? []).map((a) => squash(decodeEntities(a.name ?? [a.given, a.family].filter(Boolean).join(" ")))!).filter(Boolean),
    year,
    date: year ? [year, month, day].filter(Boolean).map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-") : undefined,
    journal: squash(decodeEntities(work["container-title"]?.[0] ?? "")),
    volume: work.volume,
    issue: work.issue,
    page: work.page ?? work["article-number"],
    publisher: work.publisher,
    abstract: work.abstract ? stripJats(work.abstract) : undefined,
    citationCount: work["is-referenced-by-count"],
  }
}

// One DOI's registration, as a source for resolve(). Asked for the title above all: OpenAlex keeps only
// the part before a subtitle, which ACM and others register separately ("PrefMiner" for "PrefMiner:
// mining user's preferences for intelligent mobile notification management").
export async function fetchCrossref(http: Http, doi: string, keys: { contactEmail?: string }, request: RequestOptions = {}): Promise<SourceRecord | undefined> {
  const params = new URLSearchParams()
  if (keys.contactEmail) params.set("mailto", keys.contactEmail)
  const query = params.size ? `?${params}` : ""
  try {
    const raw = await http.text(`https://${CROSSREF_HOST}/works/${encodeURIComponent(doi)}${query}`, request)
    const { message } = JSON.parse(raw) as { message?: Work & { subtitle?: string[]; type?: string } }
    if (!message?.DOI) return undefined
    const article = parseWork(message)
    return {
      source: "crossref",
      ids: { doi: article.doi },
      title: article.title === "Untitled" ? undefined : joinSubtitle(article.title, plainTitle(message.subtitle?.[0])),
      authors: article.authors.length ? article.authors : undefined,
      year: article.year,
      date: article.date,
      venue: article.journal,
      volume: article.volume,
      issue: article.issue,
      pages: article.page,
      publisher: article.publisher,
      abstract: article.abstract,
      citationCount: article.citationCount,
      raw,
    }
  } catch (error) {
    if ((error as { status?: number }).status === 404) return undefined
    throw error
  }
}

// The DOI of a paper known only by its title (a Semantic Scholar or OpenAlex record without one), when
// Crossref's best match is that title and, where both say, the same year give or take one
export async function findDoiByTitle(
  http: Http,
  title: string,
  hints: { year?: number; author?: string },
  keys: { contactEmail?: string },
  request: RequestOptions = {},
): Promise<string | undefined> {
  const params = new URLSearchParams({ "query.bibliographic": [title, hints.author].filter(Boolean).join(" "), rows: "3", select: "DOI,title,subtitle,issued" })
  if (keys.contactEmail) params.set("mailto", keys.contactEmail)
  const raw = await http.text(`https://${CROSSREF_HOST}/works?${params}`, request)
  const { message } = JSON.parse(raw) as { message?: { items?: (Work & { subtitle?: string[] })[] } }
  const wanted = titleKey(title)
  for (const work of message?.items ?? []) {
    const found = parseWork(work)
    const full = joinSubtitle(found.title, plainTitle(work.subtitle?.[0]))
    if (titleKey(found.title) !== wanted && titleKey(full) !== wanted) continue
    if (hints.year && found.year && Math.abs(hints.year - found.year) > 1) continue
    return found.doi
  }
  return undefined
}

// A title as a comparable key: letters and digits only, lower case ("Hindsight != foresight" and
// "Hindsight ≠ Foresight." match)
export function titleKey(title: string) {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

// Title and subtitle as a reader writes them: "A: b", but "Is now a good time? Opportune moments"
export function joinSubtitle(title: string, subtitle: string | undefined) {
  if (!subtitle || titleKey(title).endsWith(titleKey(subtitle))) return title
  return /[?!:.]$/.test(title.trim()) ? `${title.trim()} ${subtitle}` : `${title.trim()}: ${subtitle}`
}

// Registered titles may carry markup (<i>, <sub>)
const plainTitle = (text: string | undefined) => (text ? squash(decodeEntities(text).replace(/<[^>]+>/g, "")) : undefined)

// Volume, then issue, then first page; articles not yet in an issue go last, newest first among them
function issueOrder(a: JournalArticle, b: JournalArticle) {
  const num = (v: string | undefined) => (v && /^\d+/.test(v) ? Number.parseInt(v, 10) : Number.POSITIVE_INFINITY)
  return (
    num(a.volume) - num(b.volume) ||
    num(a.issue) - num(b.issue) ||
    num(a.page) - num(b.page) ||
    (b.date ?? "").localeCompare(a.date ?? "") ||
    a.title.localeCompare(b.title)
  ) || 0
}

// Crossref abstracts are JATS XML: <jats:p>, <jats:title>Abstract</jats:title>, entities
const stripJats = (xml: string) => squash(decodeEntities(xml.replace(/<jats:title>\s*Abstract\s*<\/jats:title>/i, "").replace(/<[^>]+>/g, " ")))
