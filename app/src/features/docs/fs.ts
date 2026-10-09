import { undo } from "@codemirror/commands"
import { toast } from "sonner"
import { newId } from "@/lib/id"
import { setWorkspaceFs, setWorkspaceNotes } from "@/features/chat/agent/client"
import { docUri } from "./lib/mentions"
import { isDiskChange } from "./disk"
import { openEditor, replaceInEditor, spanChange } from "./editors"
import { useDocsStore } from "./store"
import { displayName, isMarkdown, type WorkspaceFile } from "./types"

const fileAt = (path: string) => Object.values(useDocsStore.getState().files).find((f) => f.path === path)

// The doc a [[wikilink]] names: the first called Name, or the one at that path
export function wikilinkFile(files: Record<string, WorkspaceFile>, name: string) {
  const want = name.toLowerCase().replace(/\.md$/, "")
  return Object.values(files).find(
    (f) => isMarkdown(f.path) && (displayName(f.path).toLowerCase() === want || f.path.toLowerCase().replace(/\.md$/, "") === want),
  )
}

// The text of a doc as it is now: the open editor's, else the stored file's
const currentText = (id: string) => openEditor(id)?.state.doc.toString() ?? useDocsStore.getState().files[id]?.content ?? ""

// Writes a doc without the user having typed it: through its editor when open, else straight to the file,
// leaving its edit time as it was
function rewrite(id: string, content: string) {
  if (!replaceInEditor(id, content)) useDocsStore.getState().writeDoc(id, content, true)
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// When a doc is renamed or moved, links to it in every other doc follow. A link whose label is still the
// doc's old name takes the new one; a label the writer chose stays.
useDocsStore.subscribe((state, prev) => {
  if (isDiskChange()) return
  const moves = Object.values(state.files).flatMap((f) => {
    const before = prev.files[f.id]
    if (!before || before.path === f.path || !isMarkdown(f.path)) return []
    // [[Name]] links follow only when the name led to this doc, not to another doc of the same name
    const named = wikilinkFile(prev.files, displayName(before.path))?.id === f.id
    return [{ from: before.path, to: f.path, named }]
  })
  if (!moves.length) return
  for (const doc of Object.values(state.files)) {
    if (!isMarkdown(doc.path)) continue
    const text = currentText(doc.id)
    let next = text
    for (const { from, to, named } of moves) {
      const oldUri = docUri(from)
      if (next.includes(oldUri))
        next = next.replace(new RegExp(`\\[([^\\]]*)\\]\\(${escapeRe(oldUri)}\\)`, "g"), (_m, label: string) =>
          `[${label === displayName(from) ? displayName(to) : label}](${docUri(to)})`,
        )
      // [[Name]], [[Name|shown]] and [[Name#heading]] follow a rename too; a move alone doesn't change them
      if (named && displayName(from) !== displayName(to))
        next = next.replace(new RegExp(`(!?\\[\\[)${escapeRe(displayName(from))}(?=[\\]|#])`, "gi"), (_m, open: string) => open + displayName(to))
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
    const view = openEditor(file.id)
    if (!view) {
      useDocsStore.getState().writeDoc(file.id, content)
      return
    }
    const before = view.state.doc.toString()
    const change = spanChange(before, content)
    if (change.from === change.to && !change.insert) return
    view.dispatch({ changes: change, userEvent: "input.agent" })
    const after = view.state.doc.toString()
    toast("Edit applied", {
      description: displayName(file.path),
      action: {
        label: "Undo",
        // Once the doc has been closed its editor's history is gone: the text goes back if nothing changed since
        onClick: () => {
          if (openEditor(file.id) === view) undo(view)
          else if (currentText(file.id) === after) rewrite(file.id, before)
        },
      },
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
      id: newId(),
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
