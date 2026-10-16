import { useLibraryStore } from "../store"
import type { Highlight } from "@owlit/protocol"

// Where a paper's note is kept in the workspace; an agent edits the note by writing this file
export const notePathOf = (paperId: string) => `library/papers/${paperId}/note.md`

// The paper whose note is at this path, if it is one. Older chats name the note where older workspaces
// keep it (.owlit/papers/<id>/note.md), so their results still read as the note.
export const paperOfNotePath = (path: string) => /^(?:\.owlit|library)\/papers\/([^/]+)\/note\.md$/.exec(path)?.[1]

// A highlight as a quote in the note, its page a link back to the passage
function highlightQuote(h: Highlight): string {
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
