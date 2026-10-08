import { undo } from "@codemirror/commands"
import type { EditorView } from "@codemirror/view"
import { toast } from "sonner"
import { setWorkspaceFs, setWorkspaceNotes } from "@/features/chat/agent/client"
import { docUri } from "./lib/mentions"
import { useDocsStore } from "./store"
import { displayName, isMarkdown } from "./types"

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

// The text of a doc as it is now: the open editor's, else the stored file's
const currentText = (id: string) => openEditors.get(id)?.state.doc.toString() ?? useDocsStore.getState().files[id]?.content ?? ""

// Writes a doc without the user having typed it: through its editor when open, else straight to the file
function rewrite(id: string, content: string) {
  const view = openEditors.get(id)
  if (!view) return useDocsStore.getState().writeDoc(id, content)
  const change = spanChange(view.state.doc.toString(), content)
  if (change.from !== change.to || change.insert) view.dispatch({ changes: change })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// When a doc is renamed or moved, links to it in every other doc follow. A link whose label is still the
// doc's old name takes the new one; a label the writer chose stays.
useDocsStore.subscribe((state, prev) => {
  const moves = Object.values(state.files).flatMap((f) => {
    const before = prev.files[f.id]
    return before && before.path !== f.path && isMarkdown(f.path) ? [{ from: before.path, to: f.path }] : []
  })
  if (!moves.length) return
  for (const doc of Object.values(state.files)) {
    if (!isMarkdown(doc.path)) continue
    const text = currentText(doc.id)
    let next = text
    for (const { from, to } of moves) {
      const oldUri = docUri(from)
      if (next.includes(oldUri))
        next = next.replace(new RegExp(`\\[([^\\]]*)\\]\\(${escapeRe(oldUri)}\\)`, "g"), (_m, label: string) =>
          `[${label === displayName(from) ? displayName(to) : label}](${docUri(to)})`,
        )
      // [[Name]], [[Name|shown]] and [[Name#heading]] follow a rename too; a move alone doesn't change them
      if (displayName(from) !== displayName(to))
        next = next.replace(new RegExp(`(!?\\[\\[)${escapeRe(displayName(from))}(?=[\\]|#])`, "gi"), `$1${displayName(to)}`)
    }
    if (next !== text) rewrite(doc.id, next)
  }
})

// What agents read and write, the way ACP's fs/read_text_file and fs/write_text_file are served by the app
setWorkspaceFs({
  async readTextFile(path) {
    const file = fileAt(path)
    return file ? currentText(file.id) : null
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

const CONTEXT = 32

// Agents' notes land beside the doc, anchored by the quoted passage and a little text either side of it
setWorkspaceNotes({
  async addNote({ path, quote, text, by, chatId }) {
    const file = fileAt(path)
    if (!file) return false
    const doc = currentText(file.id)
    const at = doc.indexOf(quote)
    if (at < 0 || !quote.trim()) return false
    useDocsStore.getState().addNote(file.id, {
      id: crypto.randomUUID().slice(0, 8),
      quote,
      prefix: doc.slice(Math.max(0, at - CONTEXT), at),
      suffix: doc.slice(at + quote.length, at + quote.length + CONTEXT),
      text,
      by,
      chatId,
      createdAt: Date.now(),
    })
    return true
  },
})
