import { useEffect, useRef } from "react"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// Keyboard and scroll behaviour shared by the list and table layouts.
// ↑↓ move (⇧ extends), Space peeks, Enter opens, S stars, ⌫ removes, ⌘A selects all, Esc folds then clears.
export function usePaperListKeys(order: string[]) {
  const scroller = useRef<HTMLDivElement>(null)
  const actions = usePaperActions()
  const cursorId = useLibraryUi((s) => s.cursorId)
  const setScrollTop = useLibraryUi((s) => s.setScrollTop)

  // Restore the scroll position left when a paper was opened, and remember it on the way out
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = useLibraryUi.getState().scrollTop
    return () => setScrollTop(el.scrollTop)
  }, [setScrollTop])

  // Keep the keyboard cursor in view
  useEffect(() => {
    if (!cursorId) return
    scroller.current?.querySelector<HTMLElement>(`[data-paper-id="${cursorId}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cursorId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A menu button already used the key (↓ opens its menu)
    if (e.defaultPrevented) return
    const target = e.target as HTMLElement
    if (target.closest("input, textarea, [contenteditable], [role=menu], [role=tablist]")) return
    // A button keeps Enter and Space, but ↑↓ still reach the list, so a click on a chip or the
    // layout toggle doesn't leave the keyboard stranded in the toolbar
    const onControl = !!target.closest("button, a")
    if (onControl && e.key !== "ArrowDown" && e.key !== "ArrowUp") return
    const ui = useLibraryUi.getState()
    const idx = ui.cursorId ? order.indexOf(ui.cursorId) : -1
    const mod = e.metaKey || e.ctrlKey
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault()
        if (order.length === 0) return
        const next = idx < 0 ? 0 : e.key === "ArrowDown" ? Math.min(idx + 1, order.length - 1) : Math.max(idx - 1, 0)
        ui.moveCursor(order[next], e.shiftKey, order)
        // Take focus into the list so the next Enter or Space acts on the row, not the control
        if (onControl) scroller.current?.focus({ preventScroll: true })
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
