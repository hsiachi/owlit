import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { citation } from "./lib/format"
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

  const copyCitation = async (paper: Paper) => {
    try {
      await navigator.clipboard.writeText(citation(paper))
      toast("Citation copied")
    } catch {
      toast.error("Could not write to the clipboard")
    }
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

  return { open, setStarred, setStatus, copyCitation, remove, editDetails }
}
