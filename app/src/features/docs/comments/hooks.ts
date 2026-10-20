import { useEffect, useMemo } from "react"
import { useNames } from "@/lib/actors"
import { setHotComment, NEW_KEY } from "../editor/comment-marks"
import { openEditor } from "../editors"
import { useDocsUiStore } from "../ui-store"
import { useCommentTops } from "./layout"
import { useShareStore } from "../share/store"
import { useDocsStore } from "../store"
import { commentViews, resolvedViews, type CommentView } from "./model"

function useSources(fileId: string) {
  const own = useDocsStore((s) => s.comments[fileId])
  const path = useDocsStore((s) => s.files[fileId]?.path ?? "")
  const readers = useShareStore((s) => s.comments[path])
  return [own, readers] as const
}

// The open comments on a doc, Owlit's, yours and share readers', merged
export function useCommentViews(fileId: string): CommentView[] {
  const [own, readers] = useSources(fileId)
  // Their names come from the roster
  const roster = useNames()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => commentViews(own, readers), [own, readers, roster])
}

// The ones put away, newest first
export function useResolvedViews(fileId: string): CommentView[] {
  const [own, readers] = useSources(fileId)
  const roster = useNames()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => resolvedViews(own, readers), [own, readers, roster])
}

// ⌥⌘] and ⌥⌘[ open the next and previous comment in the order their words come, from the open one (or
// from the top or the bottom when none is open); its words scroll into view as when opened from its card
export function useCommentSteps(fileId: string) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return
      // By the key's place: with ⌥ held, the bracket keys type other characters
      const step = e.code === "BracketRight" ? 1 : e.code === "BracketLeft" ? -1 : 0
      const tops = useCommentTops.getState()[fileId]
      if (!step || !tops) return
      const keys = Object.entries(tops)
        .filter(([key]) => key !== NEW_KEY)
        .sort((a, b) => a[1].top - b[1].top)
        .map(([key]) => key)
      if (!keys.length) return
      e.preventDefault()
      const ui = useDocsUiStore.getState()
      const i = ui.openComment?.docId === fileId ? keys.indexOf(ui.openComment.key) : -1
      const next = i < 0 ? keys[step > 0 ? 0 : keys.length - 1] : keys[(i + step + keys.length) % keys.length]
      openEditor(fileId)?.dispatch({ effects: setHotComment.of(null) })
      ui.setOpenComment(fileId, next)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [fileId])
}
