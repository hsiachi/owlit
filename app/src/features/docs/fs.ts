import { undo } from "@codemirror/commands"
import type { EditorView } from "@codemirror/view"
import { toast } from "sonner"
import { setWorkspaceFs } from "@/features/chat/agent/client"
import { useDocsStore } from "./store"
import { displayName } from "./types"

// Docs open in an editor, by file id. An agent's write to an open doc goes through its editor, so it lands
// as one undoable change and the cursor stays where the user left it.
const openEditors = new Map<string, EditorView>()

export function registerEditor(id: string, view: EditorView) {
  openEditors.set(id, view)
  return () => {
    if (openEditors.get(id) === view) openEditors.delete(id)
  }
}

const fileAt = (path: string) => Object.values(useDocsStore.getState().files).find((f) => f.path === path)

// The smallest change that turns `from` into `to`: one replaced span between a shared prefix and suffix
export function spanChange(from: string, to: string) {
  let start = 0
  while (start < from.length && start < to.length && from[start] === to[start]) start++
  let end = 0
  while (end < from.length - start && end < to.length - start && from[from.length - 1 - end] === to[to.length - 1 - end]) end++
  return { from: start, to: from.length - end, insert: to.slice(start, to.length - end) }
}

// What agents read and write, the way ACP's fs/read_text_file and fs/write_text_file are served by the app
setWorkspaceFs({
  async readTextFile(path) {
    const file = fileAt(path)
    if (!file) return null
    const view = openEditors.get(file.id)
    return view ? view.state.doc.toString() : (file.content ?? "")
  },

  async writeTextFile(path, content) {
    const file = fileAt(path)
    if (!file) {
      const created = useDocsStore.getState().createDocAt(path, content)
      if (!created) throw new Error(`Can't write ${path}`)
      return
    }
    const view = openEditors.get(file.id)
    if (!view) {
      useDocsStore.getState().writeDoc(file.id, content)
      return
    }
    const change = spanChange(view.state.doc.toString(), content)
    if (change.from === change.to && !change.insert) return
    view.dispatch({ changes: change, userEvent: "input.agent" })
    toast("Edit applied", {
      description: displayName(file.path),
      action: { label: "Undo", onClick: () => undo(view) },
    })
  },
})
