import { readFile } from "node:fs/promises"
import { isPdfBytes } from "./pdf.ts"
import { identify } from "./text/identify.ts"
import { readPdf } from "./text/extract.ts"

// Which paper a PDF is, from what its first pages say, for a PDF owlit didn't choose by address: one the
// user's browser handed over without naming a paper, one a repository's page named, one found by title.

// What a PDF says about itself: a DOI on its first pages, and their text
export interface PdfLook {
  doi?: string
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
  return { doi: found.ref?.kind === "doi" ? found.ref.value : undefined, text: words }
}

// The one of these papers a PDF surely is: the one whose DOI it carries, else the one whose whole title
// is on its pages. Never a guess: a PDF that names neither is nobody's.
export function surelyOf<P extends { doi?: string; title: string }>(said: PdfLook, papers: readonly P[]): P | undefined {
  const text = normalize(said.text)
  return (
    papers.find((p) => p.doi && said.doi && p.doi.toLowerCase() === said.doi.toLowerCase()) ??
    papers.find((p) => normalize(p.title).length >= 20 && text.includes(normalize(p.title)))
  )
}

// Whether a PDF is this paper: yes (its DOI, or its whole title), no (a title long enough to tell, or
// another DOI, and neither matches), or unknown (no text to read, a title too short to be sure of)
export function isThisPaper(said: PdfLook | undefined, paper: { doi?: string; title: string }): "yes" | "no" | "unknown" {
  if (!said?.text.trim()) return "unknown"
  if (paper.doi && said.doi && paper.doi.toLowerCase() === said.doi.toLowerCase()) return "yes"
  const title = normalize(paper.title)
  if (title.length >= 20 && normalize(said.text).includes(title)) return "yes"
  return title.length >= 20 || said.doi ? "no" : "unknown"
}

// The same title, whatever its case, punctuation and spacing; only titles long enough to tell
export const sameTitle = (a: string, b: string) => normalize(a).length >= 20 && normalize(a) === normalize(b)

const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
