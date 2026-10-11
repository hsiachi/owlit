import type { PdfDocumentObject, PdfEngine } from "@embedpdf/models"
import { rectsWithinSlice } from "@embedpdf/plugin-selection"
import type { Rect } from "../types"

// Finding a quoted passage again in the PDF. A passage is known by its words, not by coordinates, so it
// survives a re-downloaded PDF. A long passage rarely matches as one search (line breaks, hyphens,
// ligatures), so it is found by a short phrase that opens it and one that closes it; the text between the
// two is the passage.

export interface PassageTarget {
  id: string
  start: string
  end: string
  // 0-based page tried first
  page?: number
}

interface Located {
  page: number
  // Char range on the page, as PDFium and the selection plugin count glyphs
  from: number
  to: number
  // One rect per line, PDF points from the page's top-left
  rects: Rect[]
}

// A passage seldom runs longer than this many characters
const SPAN = 2500

const cache = new WeakMap<PdfDocumentObject, Map<string, Promise<Located | null>>>()

// "a b c d e" → ["a b c d e", "a b c d", "a b c"]: shorter phrases for when the full one breaks across lines
function shorter(phrase: string, fromEnd: boolean) {
  const words = phrase.trim().split(/\s+/)
  const out: string[] = []
  for (let n = words.length; n >= Math.min(3, words.length); n--) out.push((fromEnd ? words.slice(words.length - n) : words.slice(0, n)).join(" "))
  return out
}

async function hits(engine: PdfEngine, doc: PdfDocumentObject, phrase: string) {
  const res = await engine.searchAllPages(doc, phrase, { flags: [] }).toPromise()
  return res.results
}

async function find(engine: PdfEngine, doc: PdfDocumentObject, p: PassageTarget): Promise<Located | null> {
  let starts: Awaited<ReturnType<typeof hits>> = []
  for (const phrase of shorter(p.start, false)) {
    starts = await hits(engine, doc, phrase)
    if (starts.length) break
  }
  if (!starts.length) return null
  // The hinted page first, then reading order
  starts.sort((a, b) => Number(b.pageIndex === p.page) - Number(a.pageIndex === p.page) || a.pageIndex - b.pageIndex || a.charIndex - b.charIndex)

  for (const phrase of shorter(p.end, true)) {
    const ends = await hits(engine, doc, phrase)
    for (const s of starts) {
      const e = ends.find((x) => x.pageIndex === s.pageIndex && x.charIndex >= s.charIndex && x.charIndex - s.charIndex < SPAN)
      if (!e) continue
      const page = doc.pages[s.pageIndex]
      const geo = await engine.getPageGeometry(doc, page).toPromise()
      const from = s.charIndex
      const to = e.charIndex + e.charCount - 1
      const rects = rectsWithinSlice(geo, from, to).map((r) => ({ x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height }))
      return { page: s.pageIndex, from, to, rects }
    }
  }
  // The end never turned up near the start: the start phrase alone still says where it is
  const s = starts[0]
  return { page: s.pageIndex, from: s.charIndex, to: s.charIndex + s.charCount - 1, rects: s.rects.map((r) => ({ x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height })) }
}

export function locatePassage(engine: PdfEngine, doc: PdfDocumentObject, p: PassageTarget): Promise<Located | null> {
  let byId = cache.get(doc)
  if (!byId) cache.set(doc, (byId = new Map()))
  const key = `${p.id}|${p.start}|${p.end}`
  let hit = byId.get(key)
  if (!hit) {
    hit = find(engine, doc, p).catch(() => null)
    byId.set(key, hit)
  }
  return hit
}

// The box around a passage's lines
export function boundsOf(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y }
}
