import { topLevel } from "../../actions"
import { useDocsStore } from "../../store"
import { isWithin } from "../../types"
import { useDocsUiStore } from "../../ui-store"

// A drag carries the row keys it moves: the row it started on, or every picked row when it started on one
// of them
const DRAG_TYPE = "application/x-owlit-docs"

export const carriesRows = (e: React.DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE)

export function dragStart(e: React.DragEvent, key: string) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(useDocsUiStore.getState().actingOn(key)))
  e.dataTransfer.effectAllowed = "move"
}

// The row keys a drop brings, or null for anything else dropped
export function droppedRows(e: React.DragEvent): string[] | null {
  const raw = e.dataTransfer.getData(DRAG_TYPE)
  return raw ? (JSON.parse(raw) as string[]) : null
}

// Moves rows into a folder ("" is the workspace root). What sits inside a moved folder goes with it, and a
// folder never goes inside itself.
export function moveInto(folder: string, keys: string[]) {
  const store = useDocsStore.getState()
  const ui = useDocsUiStore.getState()
  const { folders, files } = topLevel(keys)
  for (const path of folders) {
    if (isWithin(folder, path)) continue
    const wasOpen = ui.expanded[path]
    const to = store.moveFolder(path, folder)
    if (wasOpen) ui.setExpanded(to, true)
  }
  for (const id of files) store.moveFile(id, folder)
  if (keys.length > 1) ui.setPicked([], null)
  if (folder) ui.expandTo(folder)
}
