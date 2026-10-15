import { t } from "@lingui/core/macro"
import { anchorAt } from "@owlit/protocol"
import { undo } from "@codemirror/commands"
import { newId } from "@/lib/id"
import { setWorkspaceFs, setWorkspaceNotes } from "@/features/chat/agent/client"
import { isDiskChange } from "./disk"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { clientId, registerUiHandler } from "@/lib/ui-actions"
import { undoChange } from "@/lib/versions"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { spanChange } from "@/lib/text-diff"
import { onEditorsChanged, openEditor, openEditorIds, replaceInEditor } from "./editors"
import { fileAt, perFiles, useDocsStore } from "./store"
import { displayName, docUri, isMarkdown, type WorkspaceFile } from "./types"
import { chatOnScreen, labelOf } from "@/features/chat/results"
import { toastUndo } from "@/lib/toast"
import { markOwlitEdit } from "@/features/home/trail"

// What [[wikilinks]] can name: each doc by its name and by its path, the first doc keeping a name
const linkNames = perFiles((files) => {
  const names = new Map<string, WorkspaceFile>()
  for (const f of Object.values(files)) {
    if (!isMarkdown(f.path)) continue
    for (const key of [displayName(f.path).toLowerCase(), f.path.toLowerCase().replace(/\.md$/, "")]) if (!names.has(key)) names.set(key, f)
  }
  return names
})

// The doc a [[wikilink]] names: the first called Name, or the one at that path
export const wikilinkFile = (files: Record<string, WorkspaceFile>, name: string) => linkNames(files).get(name.toLowerCase().replace(/\.md$/, ""))

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
      markOwlitEdit(created.path)
      return
    }
    if (!applyAgentEdit(file, content)) useDocsStore.getState().writeDoc(file.id, content)
    markOwlitEdit(file.path)
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
  toastUndo(
    t`Edit applied`,
    () => {
      if (openEditor(file.id) === view) undo(view)
      else if (versionId) restoreVersion(versionId, file.path)
      else if (currentText(file.id) === after) rewrite(file.id, before)
    },
    { description: displayName(file.path) },
  )
  return true
}

const restoreVersion = (versionId: string, path: string) => undoChange(versionId, displayName(path))

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
    const applied = !!file && applyAgentEdit(file, content, versionId)
    if (applied) markOwlitEdit(file.path)
    return { applied }
  })

  // An undo took a comment an agent left away
  onNotify("comments.removed", ({ path, id }) => {
    const file = fileAt(path)
    if (!file || !useDocsStore.getState().comments[file.id]?.some((c) => c.id === id)) return
    useDocsStore.setState((s) => ({ comments: { ...s.comments, [file.id]: (s.comments[file.id] ?? []).filter((c) => c.id !== id) } }))
  })

  // A comment an agent left over owlit-mcp, or one an undo put back; the window's own changes are here already
  onNotify("comments.changed", ({ path, comment }) => {
    const file = fileAt(path)
    if (!file) return
    useDocsStore.setState((s) => ({
      comments: { ...s.comments, [file.id]: [...(s.comments[file.id] ?? []).filter((c) => c.id !== comment.id), comment].sort((a, b) => a.createdAt - b.createdAt) },
    }))
  })

  // A doc no window had open: core wrote it; the change itself arrives as docs.changed
  onNotify("agent.wrote", ({ path, versionId, chatId }) => {
    markOwlitEdit(path)
    // A chat on screen says it in its own result row, with the same Undo
    if (chatOnScreen(chatId)) return
    const paper = labelOf(path)
    toastUndo(t`Edit applied`, () => restoreVersion(versionId, path), {
      // A paper's note is named by its paper
      description: path.startsWith(".owlit/") ? t`Your note on ${paper}` : displayName(path),
    })
  })
}

// Agents' comments land beside the doc, anchored by the quoted passage and a little text either side of it
setWorkspaceNotes({
  async addNote({ path, quote, text, by, chatId }) {
    const file = fileAt(path)
    if (!file) return false
    const doc = currentText(file.id)
    const at = doc.indexOf(quote)
    if (at < 0 || !quote.trim()) return false
    const now = Date.now()
    useDocsStore.getState().addComment(file.id, {
      id: newId(),
      ...anchorAt(doc, at, at + quote.length),
      entries: [{ id: newId(), by: "owlit", agent: by, text, at: now, ...(chatId ? { chatId } : {}) }],
      createdAt: now,
    })
    return true
  },
})
