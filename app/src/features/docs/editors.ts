import type { EditorView } from "@codemirror/view"

// Docs open in an editor, by file id. Changes that don't come from the keyboard (an agent's write, the
// file changing on disk) go through the open editor, so they land as one undoable change and the
// cursor stays where the user left it.
const openEditors = new Map<string, EditorView>()
const listeners = new Set<() => void>()

export function registerEditor(id: string, view: EditorView) {
  openEditors.set(id, view)
  for (const l of listeners) l()
  return () => {
    if (openEditors.get(id) !== view) return
    openEditors.delete(id)
    for (const l of listeners) l()
  }
}

// Doc ids with an editor open now
export const openEditorIds = () => [...openEditors.keys()]

// Hears editors opening and closing; returns an unsubscribe
export function onEditorsChanged(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const openEditor = (id: string) => openEditors.get(id)

// The smallest change that turns `from` into `to`: one replaced span between a shared prefix and suffix
export function spanChange(from: string, to: string) {
  let start = 0
  while (start < from.length && start < to.length && from[start] === to[start]) start++
  let end = 0
  while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
}

// Puts new text into an open editor as one change; false when the doc isn't open
export function replaceInEditor(id: string, content: string, userEvent?: string) {
  const view = openEditors.get(id)
  if (!view) return false
  const change = spanChange(view.state.doc.toString(), content)
  if (change.from !== change.to || change.insert) view.dispatch({ changes: change, ...(userEvent ? { userEvent } : {}) })
  return true
}
