import { undo } from "@codemirror/commands"
import { toast } from "sonner"
import { newId } from "@/lib/id"
import { setWorkspaceFs, setWorkspaceNotes } from "@/features/chat/agent/client"
import { docUri } from "./lib/mentions"
import { isDiskChange } from "./disk"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { clientId, registerUiHandler } from "@/lib/ui-actions"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { onEditorsChanged, openEditor, openEditorIds, replaceInEditor, spanChange } from "./editors"
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
    if (!applyAgentEdit(file, content)) useDocsStore.getState().writeDoc(file.id, content)
  },
})

// An agent's edit to an open doc: one change in its editor (the cursor stays, ⌘Z takes it back) and a
// toast with Undo. Once the doc has been closed its editor's history is gone, so Undo puts back the
// version core kept (desktop) or the text from before, if nothing changed since. False when not open.
function applyAgentEdit(file: WorkspaceFile, content: string, versionId?: string) {
  const view = openEditor(file.id)
  if (!view) return false
  const before = view.state.doc.toString()
  const change = spanChange(before, content)
  if (change.from === change.to && !change.insert) return true
  view.dispatch({ changes: change, userEvent: "input.agent" })
  const after = view.state.doc.toString()
  toast("Edit applied", {
    description: displayName(file.path),
    action: {
      label: "Undo",
      onClick: () => {
        if (openEditor(file.id) === view) undo(view)
        else if (versionId) restoreVersion(versionId)
        else if (currentText(file.id) === after) rewrite(file.id, before)
      },
    },
  })
  return true
}

function restoreVersion(versionId: string) {
  rpc.versions.restore({ id: versionId }).catch((error: Error) => toast.error(error.message))
}

// ---- The desktop app: agents' reads and writes come from core ----

if (isDesktop) {
  // Core routes an agent's reads and writes of a doc to the window that has it open
  let reported = ""
  const report = () => {
    const { files } = useDocsStore.getState()
    const paths = openEditorIds()
      .map((id) => files[id]?.path)
      .filter((p): p is string => !!p)
      .sort()
    const key = paths.join("\n")
    if (key === reported || !useWorkspace.getState().current) return
    reported = key
    void rpc.ui.setOpenDocs({ clientId, paths }).catch(() => undefined)
  }
  onEditorsChanged(report)
  useDocsStore.subscribe((s, prev) => s.files !== prev.files && report())
  onWorkspaceOpened(() => {
    reported = ""
    report()
  })

  registerUiHandler("fs.read", ({ path }) => {
    const file = fileAt(path)
    const view = file ? openEditor(file.id) : undefined
    return { content: view ? view.state.doc.toString() : null }
  })
  registerUiHandler("fs.write", ({ path, content, versionId }) => {
    const file = fileAt(path)
    return { applied: !!file && applyAgentEdit(file, content, versionId) }
  })

  // A note an agent left over owlit-mcp; the window's own notes are already here
  onNotify("notes.added", ({ path, note }) => {
    const file = fileAt(path)
    if (!file || useDocsStore.getState().notes[file.id]?.some((n) => n.id === note.id)) return
    useDocsStore.setState((s) => ({ notes: { ...s.notes, [file.id]: [...(s.notes[file.id] ?? []), note] } }))
  })

  // A doc no window had open: core wrote it; the change itself arrives as docs.changed
  onNotify("agent.wrote", ({ path, versionId }) => {
    toast("Edit applied", {
      description: displayName(path),
      action: { label: "Undo", onClick: () => restoreVersion(versionId) },
    })
  })
}

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
