import { useEffect, useRef } from "react"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// What a click on a control inside the list (a button, a field, a menu, a dialog opened from a row) does is
// its own business, never a row's
const CONTROL = "button, a, input, textarea, select, [contenteditable], [role=menu], [role=menuitem], [role=dialog]"

// Keyboard, pointer and scroll behaviour shared by the list and table layouts.
//
// The list is three steps, row, card, paper: a click on a row goes one step in (a closed row opens its
// card in place, an open card's title line opens the paper) and Esc or Back goes one step out. So a
// double-click is two steps in and needs no telling apart from one click: nothing waits, and nothing folds
// on the way. ⌘-click toggles, ⇧-click extends; a click on the sheet around the list folds the card, a click
// in the card's text does nothing, so words there can be selected.
//
// A press that follows a row's press at the same spot (the second half of a double-click, or a quick second
// click) is that row's next step, whatever is under the pointer by then: when a card folds above the row and
// the list can't scroll to make up for it, the row moves up, and the second press would otherwise land on
// a button of the card that just opened under it.
//
// Keys: ↑↓ move (⇧ extends), Space peeks, Enter opens, S stars, ⌫ removes, ⌘A selects all, Esc folds then clears.
export function usePaperListKeys(order: string[]) {
  const scroller = useRef<HTMLDivElement>(null)
  const actions = usePaperActions()
  const cursorId = useLibraryUi((s) => s.cursorId)
  const setScrollTop = useLibraryUi((s) => s.setScrollTop)
  // The last plain press on a row, and the row a press that followed it at the same spot belongs to
  const pressed = useRef<{ id: string; x: number; y: number; at: number } | null>(null)
  const again = useRef<string | null>(null)

  // The open peek belongs to this visit: it folds when the page is left, except for the paper opened from
  // it, so Back from that paper comes one step out, to its card. Checked a moment after the cleanup, since in
  // development effects run twice (StrictMode), unmounting and remounting the same page at once.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (!mounted.current) useLibraryUi.getState().leaveList()
      })
    }
  }, [])

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

  // A card that folds above a row moves the row up. Scroll by as much while it folds, so the row the person
  // clicked or moved to stays where they are looking (as far as the list can scroll).
  const holdInPlace = (id: string | null, change: () => void) => {
    const el = scroller.current
    const row = id ? el?.querySelector<HTMLElement>(`[data-paper-id="${id}"]`) : null
    if (!el || !row) return change()
    const before = row.getBoundingClientRect().top
    change()
    const end = performance.now() + layoutMs() + 80
    const step = () => {
      const now = el.querySelector<HTMLElement>(`[data-paper-id="${id}"]`)
      if (!now) return
      el.scrollTop += now.getBoundingClientRect().top - before
      if (performance.now() < end) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  // One step in: the card, then the paper
  const stepIn = (id: string) => {
    const ui = useLibraryUi.getState()
    if (ui.peekId === id) actions.open(id)
    else holdInPlace(id, () => ui.click(id, "single", order))
  }

  // Taken in the capture phase, before any button or menu trigger under the pointer sees the press
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const p = pressed.current
    if (p && e.timeStamp - p.at < AGAIN_MS && Math.abs(e.clientX - p.x) < AGAIN_PX && Math.abs(e.clientY - p.y) < AGAIN_PX) {
      again.current = p.id
      pressed.current = null
      e.stopPropagation()
      // No focus moves and no text is selected by a press that isn't the target's
      e.preventDefault()
      return
    }
    again.current = null
    const target = e.target as HTMLElement
    const row = target.closest(CONTROL) ? null : target.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId
    const plain = !(e.shiftKey || e.metaKey || e.ctrlKey)
    pressed.current = row && plain ? { id: row, x: e.clientX, y: e.clientY, at: e.timeStamp } : null
  }

  const onClickCapture = (e: React.MouseEvent) => {
    const id = again.current
    if (!id) return
    again.current = null
    e.stopPropagation()
    e.preventDefault()
    stepIn(id)
  }

  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (e.defaultPrevented || target.closest(CONTROL)) return
    const row = target.closest<HTMLElement>("[data-paper-id]")?.dataset.paperId
    const ui = useLibraryUi.getState()
    if (row) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) return ui.click(row, e.shiftKey ? "range" : "toggle", order)
      stepIn(row)
    } else if (ui.peekId && !target.closest("[data-peek-body]")) {
      holdInPlace(ui.peekId, ui.closePeek)
    }
  }

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
        holdInPlace(ui.peekId && !e.shiftKey ? order[next] : null, () => ui.moveCursor(order[next], e.shiftKey, order))
        // Take focus into the list so the next Enter or Space acts on the row, not the control
        if (onControl) scroller.current?.focus({ preventScroll: true })
        return
      }
      case " ":
        e.preventDefault()
        if (ui.cursorId) holdInPlace(ui.cursorId, () => ui.togglePeek(ui.cursorId!))
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
        if (ui.peekId) holdInPlace(ui.peekId, ui.closePeek)
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

  return { scroller, listProps: { onKeyDown, onClick, onClickCapture, onPointerDownCapture } }
}

// A second press counts as following the first within macOS's default double-click interval, and within the
// few pixels a hand moves between the two
const AGAIN_MS = 500
const AGAIN_PX = 6

// How long a fold takes now (index.css --t-layout; none under reduced motion)
function layoutMs() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return 0
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--t-layout")) || 0
}
