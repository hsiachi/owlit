import { useLibraryStore } from "../store"
import type { Highlight } from "../types"

// A highlight as a quote in the note, its page a link back to the passage
export function highlightQuote(h: Highlight): string {
  const quote = `> ${h.text.replace(/\n+/g, " ")} [p. ${h.page + 1}](owlit://highlight/${h.id})`
  return h.comment ? `${quote}\n\n${h.comment}` : quote
}

let focusEndFor: string | null = null

// Appends to the stored Markdown; the editor picks it up when the Notes tab opens
export function addHighlightToNote(h: Highlight) {
  const { notes, setNote } = useLibraryStore.getState()
  const existing = notes[h.paperId]?.content.trim() ?? ""
  setNote(h.paperId, existing ? `${existing}\n\n${highlightQuote(h)}\n` : `${highlightQuote(h)}\n`)
  focusEndFor = h.paperId
}

export function consumeFocusEnd(paperId: string): boolean {
  if (focusEndFor !== paperId) return false
  focusEndFor = null
  return true
}
