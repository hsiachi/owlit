import type { Paper, PaperKind } from "../types"

// Citations built from a paper's own metadata. Titles are left as recorded: changing their case
// would lowercase names like "Transformer" that a reader expects to keep.

function splitName(name: string): { given: string[]; family: string } {
  const parts = name.trim().split(/\s+/)
  return { family: parts.at(-1) ?? name, given: parts.slice(0, -1) }
}

// "Aidan N. Gomez" → "Gomez, A. N."
function apaAuthor(name: string): string {
  const { given, family } = splitName(name)
  const initials = given.map((g) => `${g.replace(/\.$/, "").charAt(0)}.`).join(" ")
  return initials ? `${family}, ${initials}` : family
}

// APA 7 lists up to 20 authors; past that, the first 19, an ellipsis, then the last
function apaAuthors(authors: string[]): string {
  const names = authors.map(apaAuthor)
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, . . . ${names.at(-1)}`
  return `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`
}

function link(p: Paper): string | undefined {
  if (p.ids.doi) return `https://doi.org/${p.ids.doi}`
  if (p.ids.arxiv) return `https://arxiv.org/abs/${p.ids.arxiv}`
  return p.ids.url
}

// What kind of entry it is when the resolver did not say: an arXiv id and nothing else is a preprint
export function kindOf(p: Paper): PaperKind {
  if (p.kind) return p.kind
  if (p.ids.arxiv && (!p.venue || /arxiv/i.test(p.venue))) return "preprint"
  return "other"
}

// A plain-text APA reference, enough to paste into a document
export function apaCitation(p: Paper): string {
  const authors = apaAuthors(p.authors)
  const year = `(${p.year ?? "n.d."})`
  const title = p.title.replace(/[.\s]+$/, "")
  const kind = kindOf(p)
  const source =
    kind === "preprint" ? "arXiv" : kind === "conference" && p.venue ? `In ${p.venue}` : p.venue && !/arxiv/i.test(p.venue) ? p.venue : undefined
  const head = authors ? `${authors} ${year}. ${title}.` : `${title}. ${year}.`
  return [head, source && `${source}.`, link(p)].filter(Boolean).join(" ")
}

const STOP_WORDS = new Set(["a", "an", "the", "on", "of", "for", "in", "to", "and", "with", "is", "are", "do", "does"])

const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()

// Google Scholar's shape: first author's family name, year, first real word of the title
export function bibtexKey(p: Paper): string {
  const family = ascii(splitName(p.authors[0] ?? "anon").family) || "anon"
  const word = p.title.split(/[\s:—-]+/).map(ascii).find((w) => w && !STOP_WORDS.has(w)) ?? ""
  return `${family}${p.year ?? ""}${word}`
}

const escapeTex = (s: string) => s.replace(/([&%$#_])/g, "\\$1")

const ENTRY: Record<PaperKind, string> = {
  article: "article",
  conference: "inproceedings",
  preprint: "misc",
  book: "book",
  thesis: "phdthesis",
  other: "misc",
}

export function bibtex(p: Paper): string {
  const kind = kindOf(p)
  const fields: [string, string | number | undefined][] = [
    // Double braces keep the title's capitals through any bibliography style
    ["title", `{${escapeTex(p.title)}}`],
    ["author", p.authors.map((a) => {
      const { given, family } = splitName(a)
      return given.length ? `${family}, ${given.join(" ")}` : family
    }).join(" and ")],
    ["year", p.year],
  ]
  if (kind === "article") fields.push(["journal", p.venue])
  else if (kind === "conference") fields.push(["booktitle", p.venue])
  else if (kind === "thesis") fields.push(["school", p.venue])
  else if (kind === "book") fields.push(["publisher", p.venue])
  else if (kind === "other" && p.venue) fields.push(["howpublished", p.venue])
  if (p.ids.doi) fields.push(["doi", p.ids.doi])
  if (p.ids.arxiv) fields.push(["eprint", p.ids.arxiv], ["archivePrefix", "arXiv"])
  if (!p.ids.doi && !p.ids.arxiv && p.ids.url) fields.push(["url", p.ids.url])

  const body = fields
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `  ${k} = {${k === "title" ? v : escapeTex(String(v))}}`)
    .join(",\n")
  return `@${ENTRY[kind]}{${bibtexKey(p)},\n${body}\n}`
}
