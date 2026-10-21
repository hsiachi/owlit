import { createContext } from "react"
import { parseOwlitUri, type DocCitation, type ReadFrom } from "@owlit/protocol"

// A claim about a paper, as every place Owlit writes one carries it: the paper, the page the link names,
// and the sentence the claim rests on (the link's title). How far Owlit read is known on a thread cell
// (its own depth) and in a chat's answer (what core saw the turn read); elsewhere the card works it
// out from the sentence, or says it isn't recorded.
export interface Citation {
  paperId: string
  page?: number
  quote?: string
  depth?: ReadFrom["depth"]
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

// The card's surface, the same wherever it floats (a hover card here, the doc's popover, a cell's popover):
// 24rem, so a passage with a sentence either side stays a few lines
export const citationCardSurface = "w-96 gap-0 p-3"

// What the answer around a citation was built from, as core saw its turn read (a chat's reply sets it):
// the card says how far Owlit read the cited paper from it. null: Owlit's answer, with its reads not
// recorded; undefined: not in an answer of Owlit's.
export const ReadFromContext = createContext<ReadFrom[] | null | undefined>(undefined)

// A doc's citations as core keeps them (docs.citations): who wrote each and what it rests on. The doc's
// card finds its citation here by the link as written; a citation the doc has newer than core's answer
// isn't found and is told as one whose writer isn't known.
export const DocCitationsContext = createContext<DocCitation[] | undefined>(undefined)
