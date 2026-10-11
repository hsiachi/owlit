import { pickMode, range, toggle } from "@/lib/multi-select"
import { rowKey, useDocsUiStore } from "../../ui-store"

// The rows as they show now, top to bottom; which folders are open decides that, so it's read from the page
export const visibleRows = (inside: Element | null) => Array.from(inside?.closest("[data-tree]")?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [])

export const keysOf = (rows: HTMLElement[]) => rows.map((r) => r.dataset.rowKey!)

// Puts keyboard focus on a row once it has been drawn (after a rename or a delete)
export const focusRow = (key: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tree] [data-row-key="${CSS.escape(key)}"]`)?.focus())

// The row that stands for the user's choice before any ⌘- or ⇧-click: the folder last clicked, else the
// open doc. A first ⌘-click adds to it, as it is already lit.
function currentRow(activeId: string | undefined) {
  const { selectedFolder } = useDocsUiStore.getState()
  if (selectedFolder) return rowKey.folder(selectedFolder)
  return activeId ? rowKey.file(activeId) : null
}

// ⌘-click adds or drops a row, ⇧-click takes the rows between the anchor and this one, a plain click
// drops the picks and does the row's own thing. Returns whether the click was a pick.
export function pickOnClick(e: React.MouseEvent<HTMLElement>, key: string, activeId: string | undefined) {
  const ui = useDocsUiStore.getState()
  const current = currentRow(activeId)
  const mode = pickMode(e)
  if (mode === "toggle") {
    ui.setPicked(toggle(ui.picked.length ? ui.picked : current ? [current] : [], key), key)
    return true
  }
  if (mode === "range") {
    const anchor = (ui.picked.length ? ui.pickAnchor : current) ?? key
    ui.setPicked(range(keysOf(visibleRows(e.currentTarget)), anchor, key), anchor)
    return true
  }
  if (ui.picked.length) ui.setPicked([], null)
  return false
}
