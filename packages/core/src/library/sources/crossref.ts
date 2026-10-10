import type { Http, RequestOptions } from "../../net/http.ts"
import type { Years } from "./types.ts"

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
      select: "DOI,title,author,issued,container-title,volume,issue,page,abstract,is-referenced-by-count",
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
    title: squash(decode(work.title?.[0] ?? "")) ?? "Untitled",
    authors: (work.author ?? []).map((a) => squash(decode(a.name ?? [a.given, a.family].filter(Boolean).join(" ")))!).filter(Boolean),
    year,
    date: year ? [year, month, day].filter(Boolean).map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-") : undefined,
    journal: squash(decode(work["container-title"]?.[0] ?? "")),
    volume: work.volume,
    issue: work.issue,
    page: work.page,
    abstract: work.abstract ? stripJats(work.abstract) : undefined,
    citationCount: work["is-referenced-by-count"],
  }
}

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
const stripJats = (xml: string) => squash(decode(xml.replace(/<jats:title>\s*Abstract\s*<\/jats:title>/i, "").replace(/<[^>]+>/g, " ")))

// Titles and names come with HTML entities too ("Information Processing &amp; Management")
const decode = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")

const squash = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() || undefined
