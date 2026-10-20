import type { Paper, PaperKind, Thread } from "@owlit/protocol"
import { externalLinks, surname } from "./format"

// What a reference is made from: a Library paper, or a paper a thread found
export type Citable = Pick<Paper, "id" | "title" | "authors" | "year" | "venue" | "ids" | "kind">

// Citations built from a paper's own metadata. Titles are left as recorded: changing their case
// would lowercase names like "Transformer" that a reader expects to keep.

function splitName(name: string): { given: string[]; family: string } {
  return { family: surname(name), given: name.trim().split(/\s+/).slice(0, -1) }
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

// What kind of entry it is when the resolver did not say: an arXiv id and nothing else is a preprint
export function kindOf(p: Pick<Paper, "kind" | "ids" | "venue">): PaperKind {
  if (p.kind) return p.kind
  if (p.ids.arxiv && (!p.venue || /arxiv/i.test(p.venue))) return "preprint"
  return "other"
}

// A plain-text APA reference, enough to paste into a document
export function apaCitation(p: Citable): string {
  const authors = apaAuthors(p.authors)
  const year = `(${p.year ?? "n.d."})`
  const title = p.title.replace(/[.\s]+$/, "")
  const kind = kindOf(p)
  const source =
    kind === "preprint" ? "arXiv" : kind === "conference" && p.venue ? `In ${p.venue}` : p.venue && !/arxiv/i.test(p.venue) ? p.venue : undefined
  const head = authors ? `${authors} ${year}. ${title}.` : `${title}. ${year}.`
  return [head, source && `${source}.`, externalLinks(p)[0]?.href].filter(Boolean).join(" ")
}

const STOP_WORDS = new Set(["a", "an", "the", "on", "of", "for", "in", "to", "and", "with", "is", "are", "do", "does"])

const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()

// What a key may hold besides letters and digits: BibTeX and biblatex take these in a key
const keySafe = (s: string) => s.normalize("NFKD").replace(/[^a-zA-Z0-9:._-]/g, "")

// Google Scholar's shape: first author's family name, year, first real word of the title. A family name
// with no Latin letters (one written in Chinese) has nothing to give, so the key is the DOI's suffix or
// the paper's id instead: something that names this paper, not "anon" shared by all of them.
function bibtexKey(p: Citable): string {
  const family = ascii(splitName(p.authors[0] ?? "").family)
  if (!family) return keySafe(p.ids.doi?.split("/").slice(1).join("/") ?? "") || keySafe(p.id) || "paper"
  const word = p.title.split(/[\s:—-]+/).map(ascii).find((w) => w && !STOP_WORDS.has(w)) ?? ""
  return `${family}${p.year ?? ""}${word}`
}

// TeX's special characters in a field's text. The backslash goes in the same pass as the rest, so the
// braces of \textbackslash{} aren't escaped again.
const TEX: Record<string, string> = { "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" }
const escapeTex = (s: string) => s.replace(/[\\{}~^&%$#_]/g, (c) => TEX[c] ?? `\\${c}`)

const VERBATIM = new Set(["doi", "eprint", "url"])

const ENTRY: Record<PaperKind, string> = {
  article: "article",
  conference: "inproceedings",
  preprint: "misc",
  book: "book",
  thesis: "phdthesis",
  other: "misc",
}

export function bibtex(p: Citable, key = bibtexKey(p)): string {
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
    // A DOI, an arXiv id and a URL are read as written (biblatex takes them verbatim)
    .map(([k, v]) => `  ${k} = {${k === "title" || VERBATIM.has(k) ? v : escapeTex(String(v))}}`)
    .join(",\n")
  return `@${ENTRY[kind]}{${key},\n${body}\n}`
}

// Several papers as one .bib: a key two papers would share gets a letter after the first ("wang2023large",
// "wang2023largea", "wang2023largeb"), so every entry can be cited
export function bibtexAll(papers: Citable[]): string {
  const used = new Set<string>()
  return papers
    .map((p) => {
      const base = bibtexKey(p)
      let key = base
      for (let i = 0; used.has(key); i++) key = `${base}${letters(i)}`
      used.add(key)
      return bibtex(p, key)
    })
    .join("\n\n")
}

// 0 → "a", 25 → "z", 26 → "aa"
const letters = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : letters(Math.floor(i / 26) - 1) + letters(i % 26))

// A paper link's id in a doc's Markdown: [label](owlit://library/<id>…), a citation's page and sentence
// after it or not
const PAPER_LINK = /\]\(owlit:\/\/library\/([^)\s#"]+)/g

// The papers a doc's Markdown links to, in order of first use, each once: the Library's record (an id it
// knows under another name included), else the row of a thread that found the paper. A link to a paper
// neither knows is left out.
export function citedPapers(markdown: string, library: (id: string) => Paper | undefined, threads: Record<string, Thread>): Citable[] {
  const out = new Map<string, Citable>()
  for (const [, id] of markdown.matchAll(PAPER_LINK)) {
    const paper = library(id!)
    if (paper) {
      if (!out.has(paper.id)) out.set(paper.id, paper)
      continue
    }
    if (out.has(id!)) continue
    const row = Object.values(threads)
      .flatMap((t) => t.rows)
      .find((r) => r.id === id)
    if (row) out.set(id!, { id: id!, ...row.paper })
  }
  return [...out.values()]
}
