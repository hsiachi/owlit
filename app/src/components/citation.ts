import { parseOwlitUri, type AnswerDepth } from "@owlit/protocol"

// A claim about a paper, as every place Owlit writes one carries it: the paper, the page the link names,
// and the sentence the claim rests on (the link's title). On a thread cell, how far Owlit read is the
// cell's own depth; elsewhere a sentence means it read the full text, and a bare link says nothing.
export interface Citation {
  paperId: string
  page?: number
  quote?: string
  depth?: AnswerDepth
}

// The citation an owlit:// link makes, or null when the link isn't to a paper
export function citationOf(uri: string, quote?: string): Citation | null {
  const u = parseOwlitUri(uri)
  if (u?.kind !== "paper") return null
  return { paperId: u.id, ...(u.page ? { page: u.page } : {}), ...(quote?.trim() ? { quote: quote.trim() } : {}) }
}

// How long the pointer rests on a citation before its card opens, about the system's own tooltip delay,
// so reading past a citation doesn't open one; and how long the card waits for the pointer to reach it
export const CARD_OPEN_DELAY = 500
export const CARD_CLOSE_DELAY = 150

// The card's surface, the same wherever it floats (a hover card here, the doc's popover, a cell's popover)
export const citationCardSurface = "w-80 gap-0 p-3"
