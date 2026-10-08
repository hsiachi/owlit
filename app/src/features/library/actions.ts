import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { copyText } from "./lib/clipboard"
import { apaCitation, bibtex } from "./lib/cite"
import { useLibraryStore } from "./store"
import type { Paper, ReadStatus } from "./types"
import { useUiStore } from "./ui-store"

// Actions on one or several papers, shared by the row menu, the detail pane and the paper page
export function usePaperActions() {
  const navigate = useNavigate()
  const setStarredInStore = useLibraryStore((s) => s.setStarred)
  const setStatusInStore = useLibraryStore((s) => s.setStatus)
  const removePapers = useLibraryStore((s) => s.removePapers)
  const restorePapers = useLibraryStore((s) => s.restorePapers)
  const setEditingId = useUiStore((s) => s.setEditingId)
  const clearSelection = useUiStore((s) => s.clearSelection)

  const open = (id: string) => navigate(`/library/${id}`)

  const setStarred = (ids: string[], starred: boolean) => setStarredInStore(ids, starred)

  const setStatus = (ids: string[], status: ReadStatus) => setStatusInStore(ids, status)

  // APA, one reference per line
  const copyCitation = async (papers: Paper[]) => {
    if (await copyText(papers.map(apaCitation).join("\n\n"))) toast(papers.length > 1 ? `${papers.length} citations copied` : "Citation copied")
  }

  const copyBibtex = async (papers: Paper[]) => {
    if (await copyText(papers.map(bibtex).join("\n\n"))) toast(papers.length > 1 ? `BibTeX for ${papers.length} papers copied` : "BibTeX copied")
  }

  // Removal is immediate; the toast's Undo puts everything back
  const remove = (ids: string[], opts: { afterRemove?: () => void } = {}) => {
    const removed = removePapers(ids)
    if (removed.length === 0) return
    clearSelection()
    opts.afterRemove?.()
    toast(removed.length === 1 ? "Removed from library" : `Removed ${removed.length} papers`, {
      description: removed.length === 1 ? removed[0].title : undefined,
      action: { label: "Undo", onClick: () => restorePapers(removed) },
    })
  }

  const editDetails = (id: string) => setEditingId(id)

  return { open, setStarred, setStatus, copyCitation, copyBibtex, remove, editDetails }
}
