import { readFile } from "node:fs/promises"
import { isPdfBytes } from "./pdf.ts"
import { identify } from "./text/identify.ts"
import { readPdf } from "./text/extract.ts"

// Which paper a PDF is, from what its first pages say, for a PDF owlit didn't choose by address: one the
// user's browser handed over without naming a paper, one a repository's page named, one found by title.

// What a PDF says about itself: a DOI on its first pages, or the arXiv id arXiv stamps on its first
// page, and their text
export interface PdfLook {
  doi?: string
  arxiv?: string
  text: string
}

// The DOI and words of a PDF's first two pages; undefined when it isn't a PDF or has no text to read
export async function lookAtPdf(file: string, wasmPath?: string): Promise<PdfLook | undefined> {
  const bytes = await readFile(file)
  if (!isPdfBytes(bytes)) return undefined
  const { text, meta } = await readPdf(bytes, { wasmPath, maxPages: 2 }).catch(() => ({ text: undefined, meta: {} }))
  if (!text) return undefined
  const found = identify(text, meta)
  const words = text.pages.flatMap((p) => p.blocks.flatMap((b) => b.lines.map((l) => l.text))).join(" ")
  return { doi: found.ref?.kind === "doi" ? found.ref.value : undefined, arxiv: found.ref?.kind === "arxiv" ? found.ref.value : undefined, text: words }
}

// The one of these papers a PDF surely is: the one whose DOI or arXiv id it carries, else the one whose
// whole title is on its pages (a few letters may differ, as in isThisPaper). Never a guess: a PDF that
// names none of them is nobody's.
export function surelyOf<P extends { doi?: string; arxiv?: string; title: string }>(said: PdfLook, papers: readonly P[]): P | undefined {
  const text = normalize(said.text)
  return (
    papers.find((p) => sameId(p, said)) ??
    papers.find((p) => {
      const title = normalize(p.title)
      return longEnough(title) && containsNearly(text, title, slack(title))
    })
  )
}

// The PDF names this paper's DOI or arXiv id
const sameId = (paper: { doi?: string; arxiv?: string }, said: PdfLook) =>
  (!!paper.doi && !!said.doi && paper.doi.toLowerCase() === said.doi.toLowerCase()) || (!!paper.arxiv && !!said.arxiv && paper.arxiv === said.arxiv)

// How many letters a title found on a PDF may differ by
const slack = (title: string) => Math.max(2, Math.floor(title.length * 0.05))

// Whether a PDF is this paper: yes (its DOI, or its whole title), no (a title long enough to tell, or
// another DOI, and neither matches), or unknown (no text to read, a title too short to be sure of). The
// title may differ by a few letters: a record's spelling isn't always the PDF's (arXiv lists BEIR as
// "Heterogenous", its PDF says "Heterogeneous"), while another paper's title differs by words.
export function isThisPaper(said: PdfLook | undefined, paper: { doi?: string; arxiv?: string; title: string }): "yes" | "no" | "unknown" {
  if (!said?.text.trim()) return "unknown"
  if (sameId(paper, said)) return "yes"
  const title = normalize(paper.title)
  if (longEnough(title) && containsNearly(normalize(said.text), title, slack(title))) return "yes"
  return longEnough(title) || said.doi ? "no" : "unknown"
}

// Whether text holds needle with at most `edits` letters inserted, deleted or changed (Sellers'
// approximate substring match: the needle may start anywhere in the text)
function containsNearly(text: string, needle: string, edits: number) {
  if (text.includes(needle)) return true
  let previous = Array.from({ length: needle.length + 1 }, (_, i) => i)
  for (let i = 1; i <= text.length; i++) {
    const row = [0]
    for (let j = 1; j <= needle.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (text[i - 1] === needle[j - 1] ? 0 : 1))
    }
    if (row[needle.length] <= edits) return true
    previous = row
  }
  return false
}

// The same title, whatever its case, punctuation and spacing; only titles long enough to tell
export const sameTitle = (a: string, b: string) => longEnough(normalize(a)) && normalize(a) === normalize(b)

// Letters and digits of any script (a Chinese title keeps its characters), without accents, case,
// punctuation or spaces
const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")

// A normalized title long enough to tell one paper from another: 20 letters, or 8 characters of a title
// written mostly in Chinese characters, kana or hangul, each of which says as much as a word
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
function longEnough(title: string) {
  const cjk = title.match(CJK)?.length ?? 0
  return cjk * 2 >= title.length ? title.length >= 8 : title.length >= 20
}
