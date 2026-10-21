import type { PaperIds } from "./library.ts"

// The key a paper is cited by in BibTeX and LaTeX. Google Scholar's shape, which coauthors recognise:
// first author's family name, year, first word of the title that isn't a stop word (lee2025sensible).
// Core assigns it once, when the paper joins the library, and keeps it in the paper's state
// (PaperState.citeKey), so a correction to the title or year later doesn't change a key that is already
// in someone's .bib. Here rather than in core because the renderer keys the papers a thread found.

const STOP_WORDS = new Set(["a", "an", "the", "on", "of", "for", "in", "to", "and", "with", "is", "are", "do", "does"])

const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    // The one letter NFKD leaves whole
    .replace(/ł/gi, "l")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()

// What a key may hold besides letters and digits: BibTeX and biblatex take these in a key
const keySafe = (s: string) => s.normalize("NFKD").replace(/[^a-zA-Z0-9:._-]/g, "")

export interface Citable {
  id: string
  title: string
  authors: string[]
  year?: number
  ids: PaperIds
}

// The key before collisions are settled. A family name with no Latin letters (one written in Chinese)
// has nothing to give, so the key is the DOI's suffix or the paper's id instead: something that names
// this paper, not "anon" shared by all of them.
export function citeKeyBase(p: Citable): string {
  const family = ascii(p.authors[0]?.trim().split(/\s+/).at(-1) ?? "")
  if (!family) return keySafe(p.ids.doi?.split("/").slice(1).join("/") ?? "") || keySafe(p.id) || "paper"
  const word = p.title.split(/[\s:—-]+/).map(ascii).find((w) => w && !STOP_WORDS.has(w)) ?? ""
  return `${family}${p.year ?? ""}${word}`
}

// The base, or with a letter after it when another paper has it: wang2023large, wang2023largea,
// wang2023largeb
export function uniqueCiteKey(base: string, taken: (key: string) => boolean): string {
  let key = base
  for (let i = 0; taken(key); i++) key = `${base}${letters(i)}`
  return key
}

// 0 → "a", 25 → "z", 26 → "aa"
const letters = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : letters(Math.floor(i / 26) - 1) + letters(i % 26))
