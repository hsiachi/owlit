import { plural, t } from "@lingui/core/macro"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { copyText } from "@/lib/clipboard"
import { apaCitation, bibtex } from "./lib/cite"
import { useLibraryStore } from "./store"
import type { PageRect, Paper } from "./types"
import { useLibraryUi } from "./ui-store"
import { toastUndo } from "@/lib/toast"
import { useAgentWindow } from "@/features/agent/store"
import type { QuotedSelection } from "@/features/chat/types"
import { paperMentionable } from "@/features/docs/lib/mentions"

// Actions on one or several papers, shared by the row menu, the detail pane and the paper page
export function usePaperActions() {
  const navigate = useNavigate()
  const setStarred = useLibraryStore((s) => s.setStarred)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const removePapers = useLibraryStore((s) => s.removePapers)
  const restorePapers = useLibraryStore((s) => s.restorePapers)
  const setEditingId = useLibraryUi((s) => s.setEditingId)
  const clearSelection = useLibraryUi((s) => s.clearSelection)

  const open = (id: string) => navigate(`/library/${id}`)

  // APA, one reference per line
  const copyCitation = async (papers: Paper[]) => {
    if (await copyText(papers.map(apaCitation).join("\n\n"))) toast(papers.length > 1 ? plural(papers.length, { one: "# citation copied", other: "# citations copied" }) : t`Citation copied`)
  }

  const copyBibtex = async (papers: Paper[]) => {
    if (await copyText(papers.map(bibtex).join("\n\n"))) toast(papers.length > 1 ? plural(papers.length, { one: "BibTeX for # paper copied", other: "BibTeX for # papers copied" }) : t`BibTeX copied`)
  }

  // Removal is immediate; the toast's Undo puts everything back
  const remove = (ids: string[], opts: { afterRemove?: () => void } = {}) => {
    const removed = removePapers(ids)
    if (removed.length === 0) return
    clearSelection()
    opts.afterRemove?.()
    toastUndo(removed.length === 1 ? t`Removed from library` : plural(removed.length, { one: "Removed # paper", other: "Removed # papers" }), () => restorePapers(removed), {
      description: removed.length === 1 ? removed[0].title : undefined,
    })
  }

  const editDetails = (id: string) => setEditingId(id)

  return { open, setStarred, setStatus, copyCitation, copyBibtex, remove, editDetails }
}

// Deleting is immediate; the toast's Undo brings the highlight back
export function deleteHighlight(id: string) {
  const { removeHighlight, restoreHighlight } = useLibraryStore.getState()
  const removed = removeHighlight(id)
  if (removed) toastUndo(t`Highlight deleted`, () => restoreHighlight(removed))
}

// A passage of a paper (a selection, a highlight, a line of its note) handed to the agent window; rects
// keep a PDF selection drawn until it is asked about
export function askAboutPassage(paperId: string, quote: Omit<QuotedSelection, "source">, rects?: PageRect[]) {
  const paper = useLibraryStore.getState().papers[paperId]
  if (!paper || !quote.text) return
  useAgentWindow.getState().open({ ...quote, source: paperMentionable(paper) }, rects?.length ? { paperId, rects } : undefined)
}
