import { plural, t } from "@lingui/core/macro"
import { intlLocale } from "@owlit/i18n"
import { shortDate } from "@/lib/time"
import type { Paper } from "@owlit/protocol"

// An author's family name, taken as the last word: "Aidan N. Gomez" → "Gomez"
export const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name

// "Lewis et al." / "Pirolli & Card" / "Vaswani". "et al." and "&" are how papers are cited in any
// language, so they stay as they are.
export function shortAuthors(authors: string[]): string {
  if (authors.length === 0) return t`Unknown authors`
  if (authors.length === 1) return surname(authors[0])
  if (authors.length === 2) return `${surname(authors[0])} & ${surname(authors[1])}`
  return `${surname(authors[0])} et al.`
}

// "Pirolli & Card · 2005"
export const authorsYear = (p: Pick<Paper, "authors" | "year">) => [shortAuthors(p.authors), p.year].filter(Boolean).join(" · ")

// A paper's details wherever a list names it, after or beside its title: "Pirolli & Card · 2005 · CHI".
// The venue only by its acronym, so a list's details line up in a column instead of pushing the title
// aside; a venue without one is left to the table and the paper's page.
export function paperMeta(p: Pick<Paper, "authors" | "year" | "venue">): string {
  const venue = p.venue && shortVenue(p.venue)
  return [shortAuthors(p.authors), p.year, venue !== p.venue?.trim() && venue].filter(Boolean).join(" · ")
}

// A venue short enough for a table cell, without making up a name: a name that carries its own acronym
// keeps just that ("… Human Factors in Computing Systems (CHI)" → "CHI", "CHI Conference on Human
// Factors…" → "CHI", "ACM SIGIR Conference on…" → "SIGIR"). Anything else stays whole, cut by its cell
// with the full name on hover; initials ("Applied Cognitive Psychology" → "ACP") read as noise.
export function shortVenue(venue: string): string {
  const v = venue.trim()
  const acronym = v.match(/\(([A-Z][A-Za-z]*[A-Z])\)/)
  if (acronym) return acronym[1]
  const lead = v.match(/^(?:Proceedings of (?:the )?)?(?:\d{4}\s+)?(?:(?:ACM|IEEE)\s+)?([A-Z][A-Z0-9]*[A-Z0-9])\s+(?:International\s+)?(?:Conference|Symposium|Workshop)\b/)
  if (lead && !/^(ACM|IEEE)$/.test(lead[1])) return lead[1]
  return v
}

// "Pirolli & Card 2005", the way a writer cites it
export function citationLabel(p: Pick<Paper, "authors" | "year">): string {
  return p.year ? `${shortAuthors(p.authors)} ${p.year}` : shortAuthors(p.authors)
}

export interface ExternalLink {
  kind: "doi" | "arxiv" | "url"
  // The DOI, the arXiv id, or the link's host name
  value: string
  href: string
}

export function externalLinks(p: Pick<Paper, "ids">): ExternalLink[] {
  const links: ExternalLink[] = []
  if (p.ids.doi) links.push({ kind: "doi", value: p.ids.doi, href: `https://doi.org/${p.ids.doi}` })
  if (p.ids.arxiv) links.push({ kind: "arxiv", value: p.ids.arxiv, href: `https://arxiv.org/abs/${p.ids.arxiv}` })
  if (p.ids.url) {
    let value = p.ids.url
    try {
      value = new URL(p.ids.url).hostname
    } catch {
      // keep raw
    }
    links.push({ kind: "url", value, href: p.ids.url })
  }
  return links
}

// "2,733 citations", under a paper's title
export const citationsText = (count: number) => plural(count, { one: "# citation", other: "# citations" })

// "2.7K" or "2733", "3.2万": short enough for a table cell, the interface language's way
export const citationsShort = (count: number) => count.toLocaleString(intlLocale(), { notation: "compact", maximumFractionDigits: 1 })

const SERVICES: Record<string, string> = { openalex: "OpenAlex", s2: "Semantic Scholar", crossref: "Crossref" }

// Who counted a paper's citations and when, for the count's hover: "Counted by OpenAlex, Oct 14"
export function citationsSource(citations: NonNullable<Paper["citations"]>) {
  const service = SERVICES[citations.source] ?? citations.source
  const when = citations.at ? shortDate(citations.at) : ""
  if (!service) return when ? t`Counted ${when}` : ""
  return when ? t`Counted by ${service}, ${when}` : t`Counted by ${service}`
}
