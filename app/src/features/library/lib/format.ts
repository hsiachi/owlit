import type { Paper } from "../types"

const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name

// "Lewis et al." / "Pirolli & Card" / "Vaswani"
export function shortAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown authors"
  if (authors.length === 1) return surname(authors[0])
  if (authors.length === 2) return `${surname(authors[0])} & ${surname(authors[1])}`
  return `${surname(authors[0])} et al.`
}

// The one-line citation shown after a title: "Pirolli & Card · 2005 · CHI"
export function paperMeta(p: Paper): string {
  return [shortAuthors(p.authors), p.year, p.venue].filter(Boolean).join(" · ")
}

export function citationLabel(p: Paper): string {
  return p.year ? `${shortAuthors(p.authors)} ${p.year}` : shortAuthors(p.authors)
}

export function externalLinks(p: Paper): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = []
  if (p.ids.doi) links.push({ label: `doi:${p.ids.doi}`, href: `https://doi.org/${p.ids.doi}` })
  if (p.ids.arxiv) links.push({ label: `arXiv:${p.ids.arxiv}`, href: `https://arxiv.org/abs/${p.ids.arxiv}` })
  if (p.ids.url) {
    let label = p.ids.url
    try {
      label = new URL(p.ids.url).hostname
    } catch {
      // keep raw
    }
    links.push({ label, href: p.ids.url })
  }
  return links
}

const dateFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
const dateFmtYear = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })

export function formatAdded(ts: number): string {
  const d = new Date(ts)
  const diff = Date.now() - ts
  if (diff < 60_000) return "just now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.getFullYear() === new Date().getFullYear() ? dateFmt.format(d) : dateFmtYear.format(d)
}
