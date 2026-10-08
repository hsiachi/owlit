import { useEffect, useRef } from "react"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

// Keyboard and scroll behaviour shared by the list and table layouts.
// ↑↓ move (⇧ extends), Space peeks, Enter opens, S stars, ⌫ removes, ⌘A selects all, Esc folds then clears.
export function usePaperListKeys(order: string[]) {
  const scroller = useRef<HTMLDivElement>(null)
  const actions = usePaperActions()
  const cursorId = useUiStore((s) => s.cursorId)
  const setScrollTop = useUiStore((s) => s.setScrollTop)

  // Restore the scroll position left when a paper was opened, and remember it on the way out
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = useUiStore.getState().scrollTop
    return () => setScrollTop(el.scrollTop)
  }, [setScrollTop])

  // Keep the keyboard cursor in view
  useEffect(() => {
    if (!cursorId) return
    scroller.current?.querySelector<HTMLElement>(`[data-paper-id="${cursorId}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursorId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable], [role=menu], button")) return
    const ui = useUiStore.getState()
    const idx = ui.cursorId ? order.indexOf(ui.cursorId) : -1
    const mod = e.metaKey || e.ctrlKey
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault()
        if (order.length === 0) return
        const next = idx < 0 ? 0 : e.key === "ArrowDown" ? Math.min(idx + 1, order.length - 1) : Math.max(idx - 1, 0)
        ui.moveCursor(order[next], e.shiftKey, order)
        return
      }
      case " ":
        e.preventDefault()
        if (ui.cursorId) ui.togglePeek(ui.cursorId)
        return
      case "Enter":
        if (ui.cursorId) actions.open(ui.cursorId)
        return
      case "s":
      case "S": {
        if (mod || e.altKey || ui.selectedIds.length === 0) return
        const papers = useLibraryStore.getState().papers
        actions.setStarred(ui.selectedIds, !ui.selectedIds.every((id) => papers[id]?.starred))
        return
      }
      case "Backspace":
      case "Delete":
        if (ui.selectedIds.length > 0) actions.remove(ui.selectedIds)
        return
      case "Escape":
        if (ui.peekId) ui.closePeek()
        else ui.clearSelection()
        return
      case "a":
        if (mod) {
          e.preventDefault()
          ui.selectAll(order)
        }
        return
    }
  }

  return { scroller, onKeyDown }
}
