import { range } from "@/lib/multi-select"
import { useDocActions } from "../../actions"
import { useDocsStore } from "../../store"
import { isWithin, parentPath } from "../../types"
import { folderOfKey, rowKey, useDocsUiStore } from "../../ui-store"
import { focusRow, keysOf, visibleRows } from "./picking"

// The tree from the keyboard: ↑ ↓ move, → opens a folder or steps into it, ← closes it or steps out,
// ⇧↑ ⇧↓ pick as they move, F2 renames, ⌘⌫ deletes (with Undo), Esc drops the picks. ↵ and space are the
// row button's own.
export function useTreeKeys() {
  const { deleteKeys, startRenaming } = useDocActions()
  return (e: React.KeyboardEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row-key]")
    if (!row) return
    const key = row.dataset.rowKey!
    const rows = visibleRows(row)
    const i = rows.indexOf(row)
    const ui = useDocsUiStore.getState()
    const folder = row.dataset.folder !== undefined ? row.dataset.path! : null

    const move = (to: HTMLElement | undefined) => {
      if (!to) return
      e.preventDefault()
      to.focus()
      if (e.shiftKey) {
        const anchor = (ui.picked.length ? ui.pickAnchor : key) ?? key
        ui.setPicked(range(keysOf(rows), anchor, to.dataset.rowKey!), anchor)
      } else if (ui.picked.length) ui.setPicked([], null)
    }

    if (e.key === "ArrowDown") return move(rows[i + 1])
    if (e.key === "ArrowUp") return move(rows[i - 1])
    if (e.key === "Home") return move(rows[0])
    if (e.key === "End") return move(rows[rows.length - 1])
    if (e.key === "ArrowRight" && folder !== null) {
      e.preventDefault()
      if (!ui.expanded[folder]) ui.setExpanded(folder, true)
      else if (rows[i + 1] && parentPath(rows[i + 1].dataset.path!) === folder) rows[i + 1].focus()
      return
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      if (folder !== null && ui.expanded[folder]) return ui.setExpanded(folder, false)
      const parent = parentPath(row.dataset.path!)
      if (parent) rows.find((r) => r.dataset.rowKey === rowKey.folder(parent))?.focus()
      return
    }
    if (e.key === "F2") {
      e.preventDefault()
      return startRenaming(key)
    }
    if (e.key === "Backspace" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const keys = ui.actingOn(key)
      // Focus goes to the nearest row that stays: below first, else above
      const gone = keys.map((k) => folderOfKey(k) ?? useDocsStore.getState().files[k]?.path).filter((p): p is string => !!p)
      const stays = (r: HTMLElement) => !gone.some((g) => isWithin(r.dataset.path!, g))
      const next = rows.slice(i + 1).find(stays) ?? rows.slice(0, i).reverse().find(stays)
      deleteKeys(keys)
      if (next) focusRow(next.dataset.rowKey!)
      return
    }
    if (e.key === "Escape" && ui.picked.length) {
      e.preventDefault()
      ui.setPicked([], null)
    }
  }
}
