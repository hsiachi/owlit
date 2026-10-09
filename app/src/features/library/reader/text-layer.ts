import type { PaperText, Rect } from "@owlit/protocol"
import { isDesktop, rpc } from "@/lib/rpc"
import type { PassageTarget } from "./passages"

// A passage found in the paper's text.json (core's text layer) rather than by searching the open PDF:
// works before the reader has the document, and for agents' passages that carry only words. Same
// shape as passages.ts: a page and one rect per line, PDF points from the page's top-left. The reader
// still uses its own search; Knowledge's passage links can use this once they need it.

export interface TextHit {
  // 0-based
  page: number
  rects: Rect[]
}

const loaded = new Map<string, Promise<PaperText | null>>()

// The paper's text layer, read once per window; null without the desktop app or before it is read
export function paperText(paperId: string): Promise<PaperText | null> {
  if (!isDesktop) return Promise.resolve(null)
  let text = loaded.get(paperId)
  if (!text) {
    text = rpc.library.text({ id: paperId }).catch(() => null)
    loaded.set(paperId, text)
    // A paper not read yet may be read soon: don't keep the miss
    void text.then((t) => t || loaded.delete(paperId))
  }
  return text
}

const squash = (s: string) => s.replace(/­/g, "").replace(/\s+/g, " ").trim().toLowerCase()

// The lines from the one where `start` opens to the one where `end` closes, on the first page that has
// both (the hinted page first)
export function findPassage(text: PaperText, target: Pick<PassageTarget, "start" | "end" | "page">): TextHit | null {
  const pages = [...text.pages].sort((a, b) => (a.index === target.page ? -1 : b.index === target.page ? 1 : a.index - b.index))
  const start = squash(target.start)
  const end = squash(target.end)
  for (const page of pages) {
    const lines = page.blocks.flatMap((b) => b.lines)
    // Each line's text, and where it begins in the page's text joined by spaces
    let joined = ""
    const at: number[] = []
    for (const line of lines) {
      at.push(joined.length)
      joined += squash(line.text) + " "
    }
    const from = joined.indexOf(start)
    if (from < 0) continue
    const to = joined.indexOf(end, from)
    if (to < 0) continue
    const first = lastAtOrBefore(at, from)
    const last = lastAtOrBefore(at, to + end.length - 1)
    return { page: page.index, rects: lines.slice(first, last + 1).map((l) => l.rect) }
  }
  return null
}

function lastAtOrBefore(starts: number[], offset: number) {
  let found = 0
  for (const [i, start] of starts.entries()) if (start <= offset) found = i
  return found
}
