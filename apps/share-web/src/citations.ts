import { anchorAt, readableText, type ShareAnchor } from "@owlit/protocol"

// Where a doc cites a paper: the sentence around each citation, as the reader sees it, anchored so the
// page can scroll back to it

export interface Citation {
  sentence: string
  anchor: ShareAnchor
}

const ENDS = /[.!?。！？\n]/

export function citationsOf(markdown: string, paperId: string): Citation[] {
  const { text, at } = readableText(markdown)
  const found: Citation[] = []
  const link = new RegExp(`\\]\\(owlit://library/${paperId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:#[^)\\s]*)?\\)`, "g")
  for (const m of markdown.matchAll(link)) {
    // The citation's label ends where the link's address starts; its last drawn character is just before
    const end = at.findIndex((source) => source >= m.index)
    const pos = end === -1 ? text.length : end
    let from = pos
    while (from > 0 && !ENDS.test(text[from - 1])) from--
    let to = pos
    while (to < text.length && !ENDS.test(text[to])) to++
    if (to < text.length && text[to] !== "\n") to++
    while (from < to && /\s/.test(text[from])) from++
    const sentence = text.slice(from, to).trim()
    if (sentence && !found.some((c) => c.anchor.prefix === text.slice(Math.max(0, from - 32), from) && c.sentence === sentence)) found.push({ sentence, anchor: anchorAt(text, from, from + sentence.length) })
  }
  return found
}
