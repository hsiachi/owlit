import type { PaperText } from "@owlit/protocol"
import { doiRef, type Ref } from "../refs.ts"
import type { PdfMeta } from "./extract.ts"

// Which paper a PDF is, from its first pages: arXiv's stamp in the margin, else a DOI printed on the
// first page (publishers put it in the header or footer), else on the second. Without either it is a
// file nobody can name yet; the title and authors are then a guess from the file itself.

export interface Identified {
  ref?: Ref
  title?: string
  authors: string[]
}

const ARXIV_STAMP = /arXiv:\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/
const DOI = /(?:doi\s*:?\s*|https?:\/\/(?:dx\.)?doi\.org\/)?\b(10\.\d{4,9}\/[^\s"<>]+)/i

export function identify(text: PaperText, meta: PdfMeta): Identified {
  const pageText = (index: number) =>
    text.pages[index]?.blocks.flatMap((b) => b.lines.map((l) => l.text.replace(/­/g, ""))).join("\n") ?? ""
  const guess = { title: titleOf(text, meta), authors: authorsOf(meta) }
  const first = pageText(0)
  const stamp = first.match(ARXIV_STAMP)
  if (stamp) return { ref: { kind: "arxiv", value: stamp[1] }, ...guess }
  for (const page of [first, pageText(1)]) {
    const doi = page.match(DOI)
    if (doi) return { ref: doiRef(doi[1]), ...guess }
  }
  return guess
}

// The file's own title when it looks like one, else the first heading on the first page that reads
// like a title
function titleOf(text: PaperText, meta: PdfMeta) {
  const fromFile = meta.title?.replace(/\s+/g, " ").trim()
  if (fromFile && fromFile.length >= 8 && fromFile.includes(" ") && !/^(microsoft word|untitled|title)\b|\.(docx?|pdf|tex|dvi)$/i.test(fromFile)) {
    return fromFile
  }
  const blocks = text.pages[0]?.blocks ?? []
  const heading = blocks.find((b) => {
    const words = b.lines.map((l) => l.text).join(" ").split(/\s+/).length
    return b.kind === "heading" && words >= 3 && words <= 30
  })
  const chosen = heading ?? blocks.find((b) => b.kind !== "other")
  return chosen?.lines.map((l) => l.text).join(" ").replace(/­/g, "").replace(/\s+/g, " ").trim() || undefined
}

function authorsOf(meta: PdfMeta) {
  if (!meta.author) return []
  return meta.author
    .split(/\s*(?:;|,|\band\b|&)\s*/)
    .map((a) => a.trim())
    .filter((a) => a.length > 1 && !/^(admin|user|author)$/i.test(a))
}
