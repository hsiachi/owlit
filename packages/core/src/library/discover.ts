import { RpcErrorCode, type OnlineFilters, type OnlineSource, type PaperIds } from "@owlit/protocol"
import { HttpError, type Http, type RequestOptions } from "../net/http.ts"
import { RpcFailure } from "../rpc/index.ts"
import type { MetadataKeys } from "./resolve.ts"
import { searchArxiv } from "./sources/arxiv.ts"
import { journalArticles, TooManyArticles, type JournalArticle } from "./sources/crossref.ts"
import { fetchOpenAlex, findSources, neighboursOpenAlex, searchOpenAlex } from "./sources/openalex.ts"
import { neighboursS2, s2Key, searchS2, similarS2 } from "./sources/semanticscholar.ts"
import type { SourceRecord, Years } from "./sources/types.ts"

// Finding papers outside the library: a search in one source, a paper's neighbours, a journal's list.
// What pitta learnt (2026-06, its v1 discovery): a search over merged sources can only offer the filters
// they share, and a filter applied to the merged results after each source has cut its list finds a
// handful where there are hundreds. So the caller names the source, and a filter it can't apply is
// refused with what can.

const refuse = (message: string) => new RpcFailure(RpcErrorCode.InvalidParams, message)

// 2023, 2019-2023, 2023- or -2023
export function parseYears(text: string | undefined): Years | undefined {
  if (!text?.trim()) return undefined
  const match = text.trim().match(/^(\d{4})?\s*(-)?\s*(\d{4})?$/)
  if (!match || (!match[1] && !match[3])) throw refuse(`year should look like 2023, 2019-2023, 2023- or -2023, not “${text}”.`)
  const from = match[1] ? Number(match[1]) : undefined
  const to = match[3] ? Number(match[3]) : match[2] ? undefined : from
  if (from !== undefined && to !== undefined && from > to) throw refuse(`year ${text} ends before it starts.`)
  return { from, to }
}

const NAMES: Record<OnlineSource, string> = { openalex: "OpenAlex", s2: "Semantic Scholar", arxiv: "arXiv" }

// What each source can't do, said with where it can be done
function unsupported(source: OnlineSource, filters: OnlineFilters): string | undefined {
  const { sort, minCitations, type, author, venue } = filters
  const name = NAMES[source]
  if (source === "s2") {
    if (sort && sort !== "relevance") return `${name} only ranks by relevance; use source openalex to sort by ${sort}.`
    if (author) return `${name} search can't filter by author; use source openalex or arxiv, or put the name in the query.`
    if (type === "preprint") return `${name} doesn't mark preprints; use source arxiv, or openalex with type preprint.`
  }
  if (source === "arxiv") {
    if (sort === "citations") return `${name} doesn't count citations; use source openalex or s2.`
    if (minCitations) return `${name} doesn't count citations; use source openalex or s2 for min_citations.`
    if (type && type !== "preprint") return `${name} only has preprints; use source openalex or s2 for type ${type}.`
    // open_access needs nothing: every arXiv paper is free to read
    if (venue) return `${name} has no venues; use source openalex or s2.`
  }
  return undefined
}

const S2_TYPES: Record<string, string[]> = { article: ["JournalArticle", "Conference"], review: ["Review"], book: ["Book", "BookSection"] }

// Companion volumes share a conference's name; a venue means its main track unless it says otherwise
const COMPANION = /extended abstracts|companion|adjunct|workshop|poster|demo/i

export async function searchSource(
  http: Http,
  query: string,
  limit: number,
  source: OnlineSource,
  filters: OnlineFilters,
  keys: MetadataKeys,
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; total?: number; matched?: string }> {
  const problem = unsupported(source, filters)
  if (problem) throw refuse(problem)
  const years = parseYears(filters.year)
  try {
    if (source === "s2") {
      const types = filters.type ? S2_TYPES[filters.type] : undefined
      return await searchS2(http, query, limit, { years, minCitations: filters.minCitations, types, venue: filters.venue, openAccess: filters.openAccess }, keys.s2ApiKey, request)
    }
    if (source === "arxiv") return await searchArxiv(http, query, limit, { years, author: filters.author, newest: filters.sort === "newest" }, request)
    let sources: string[] | undefined
    let matched: string | undefined
    if (filters.venue) {
      const found = await findSources(http, filters.venue, keys, request)
      const wanted = COMPANION.test(filters.venue) ? found : found.filter((s) => !COMPANION.test(s.name))
      const chosen = wanted.filter((s) => s.type === wanted[0]?.type).slice(0, 3)
      if (!chosen.length) throw new RpcFailure(RpcErrorCode.NotFound, `OpenAlex knows no journal or conference called “${filters.venue}”. Try its full name, or source s2.`)
      sources = chosen.map((s) => s.id)
      matched = `venue: ${chosen.map((s) => s.name).join("; ")}`
    }
    const found = await searchOpenAlex(http, query, limit, { ...filters, years, sources }, keys, request)
    return { ...found, matched }
  } catch (error) {
    throw busy(error, NAMES[source], keys)
  }
}

// S2 without a key is shared with everyone and often says "slow down"
function busy(error: unknown, name: string, keys: MetadataKeys) {
  if (error instanceof HttpError && error.status === 429) {
    return new RpcFailure(
      RpcErrorCode.Unavailable,
      name === NAMES.s2 && !keys.s2ApiKey
        ? `${name} is too busy to answer without an API key (the user can add one in Settings › Paper sources). Try again in a minute, or use source openalex.`
        : `${name} asked owlit to slow down. Try again in a minute.`,
      { status: 429 },
    )
  }
  return error
}

export type RelatedKind = "references" | "cited_by" | "similar"

// A paper's neighbours. Published work (a DOI) goes to OpenAlex, which filters and sorts; a preprint to
// Semantic Scholar, since OpenAlex's records of arXiv papers can be another paper's (seen 2026-10-10: the
// RAG paper's arXiv DOI held a 2026 title and its references). "similar" is S2's recommender.
export async function relatedOf(
  http: Http,
  ids: PaperIds,
  kind: RelatedKind,
  limit: number,
  filters: Pick<OnlineFilters, "year" | "sort">,
  keys: MetadataKeys,
  request: RequestOptions = {},
): Promise<{ records: SourceRecord[]; total?: number; source: string; note?: string }> {
  const years = parseYears(filters.year)
  const s2 = s2Key(ids)
  try {
    if (kind === "similar") {
      if (filters.sort && filters.sort !== "relevance") throw refuse("similar papers come in the recommender's order; sort is for references and cited_by.")
      if (!s2) throw refuse("Semantic Scholar needs the paper's DOI or arXiv id to find similar papers.")
      const records = inYears(await similarS2(http, s2, years ? 100 : limit, keys.s2ApiKey, request), years)
      return { records: records.slice(0, limit), source: "s2" }
    }
    if (ids.doi && !/^10\.48550\//.test(ids.doi)) {
      const work = ids.openalex ?? (await fetchOpenAlex(http, { doi: ids.doi }, keys, request))?.ids.openalex
      if (work) {
        const found = await neighboursOpenAlex(http, work, kind, limit, { years, sort: filters.sort }, keys, request)
        // OpenAlex may not have the reference list a publisher withheld; S2 sometimes does
        if (found.records.length || kind === "cited_by" || !s2) return { ...found, source: "openalex" }
      }
    }
    if (!s2) throw new RpcFailure(RpcErrorCode.NotFound, "owlit can't follow this paper's citations: it has no DOI or arXiv id.")
    const page = await neighboursS2(http, s2, kind, keys.s2ApiKey, request)
    const all = inYears(page.records, years)
    if (filters.sort === "citations") all.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0))
    if (filters.sort === "newest") all.sort((a, b) => (b.date ?? String(b.year ?? "")).localeCompare(a.date ?? String(a.year ?? "")))
    // Past the first 1000 S2 gives, a sort or a year is over those only, and the agent should know
    const note = page.more
      ? `Semantic Scholar gives only the first 1000${filters.sort || years ? `, ${[filters.sort ? "sorted" : "", years ? "filtered" : ""].filter(Boolean).join(" and ")} among those` : ""}${kind === "cited_by" && filters.sort === "citations" ? "; for the most cited overall, use library_search on the topic with sort citations" : ""}`
      : undefined
    return { records: all.slice(0, limit), ...(page.more ? {} : { total: all.length }), source: "s2", ...(note ? { note } : {}) }
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new RpcFailure(RpcErrorCode.NotFound, "Neither OpenAlex nor Semantic Scholar knows this paper's citations.")
    throw busy(error, error instanceof HttpError && error.url.includes("openalex") ? NAMES.openalex : NAMES.s2, keys)
  }
}

const inYears = (records: SourceRecord[], years: Years | undefined) =>
  years ? records.filter((r) => r.year !== undefined && (years.from === undefined || r.year >= years.from) && (years.to === undefined || r.year <= years.to)) : records

const ISSN = /^\d{4}-?\d{3}[\dXx]$/

// A journal by name or ISSN, with the ISSNs Crossref may know it by. A conference is refused: its
// proceedings would need a list of each conference's volumes kept by hand (pitta v1 had one for 13 HCI
// venues), which owlit doesn't have yet.
export async function findJournal(http: Http, journal: string, keys: MetadataKeys, request: RequestOptions = {}): Promise<{ name: string; issns: string[] }> {
  const text = journal.trim()
  if (ISSN.test(text)) {
    const issn = text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4)}` : text
    return { name: `ISSN ${issn.toUpperCase()}`, issns: [issn.toUpperCase()] }
  }
  const found = await findSources(http, text, keys, request)
  const best = found[0]
  if (best?.type === "conference")
    throw refuse(`“${best.name}” is a conference, and owlit can only list a journal's papers for now. Use library_search with venue “${text}” instead.`)
  const journalHit = found.find((s) => s.type === "journal" && s.issns.length)
  if (!journalHit) throw new RpcFailure(RpcErrorCode.NotFound, `OpenAlex knows no journal called “${text}”. Try its full name or its ISSN.`)
  return { name: journalHit.name, issns: journalHit.issns }
}

// The journal's articles in the years, trying each ISSN until one has them: a journal keeps its old ISSN
// in OpenAlex (Information Processing & Management's 0020-0271) while Crossref files it under another
export async function listJournal(
  http: Http,
  issns: string[],
  years: Required<Years>,
  keys: MetadataKeys,
  request: RequestOptions = {},
): Promise<{ articles: JournalArticle[]; issn: string }> {
  if (years.to - years.from > 4) throw refuse("A journal list covers at most five years at a time.")
  for (const [i, issn] of issns.entries()) {
    try {
      const articles = await journalArticles(http, issn, years, keys, request)
      if (articles.length || i === issns.length - 1) return { articles, issn }
    } catch (error) {
      if (error instanceof TooManyArticles)
        throw refuse(`That journal published ${error.total} articles in those years, too many to go through. Use library_search with venue and a query instead.`)
      if (error instanceof HttpError && error.status === 404 && i < issns.length - 1) continue
      if (error instanceof HttpError && error.status === 404) throw new RpcFailure(RpcErrorCode.NotFound, "Crossref doesn't know that journal's ISSN.")
      throw busy(error, "Crossref", keys)
    }
  }
  return { articles: [], issn: issns[0] }
}
