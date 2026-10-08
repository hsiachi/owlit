import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "@/features/chat/store"
import { registerEditor } from "../fs"
import { docMentionable, docMentionItems, mentionRoute, mentionTitle } from "../lib/mentions"
import { freshDocIds, useDocsStore } from "../store"
import type { WorkspaceFile } from "../types"
import { livePreview } from "./live-preview"
import { mentionPopup } from "./mention-popup"
import { selectionMenu, type SelectionAction } from "./selection-menu"
import { agentSuggestions, pendingEdits, setPendingEdits, type PendingEdit } from "./suggestions"
import { Highlight } from "./syntax"
import { docHighlight, docTheme } from "./theme"

// Apply and Discard answer the agent's permission request with its allow-once or reject-once option
function respondToEdit(edit: PendingEdit, apply: boolean) {
  const chat = useChatStore.getState().chats[edit.chatId]
  const part = chat?.messages.at(-1)?.parts.find((p) => p.type === "permission" && p.requestId === edit.requestId)
  if (part?.type !== "permission") return
  const option = part.options.find((o) => o.kind === (apply ? "allow_once" : "reject_once")) ?? part.options.find((o) => o.kind.startsWith(apply ? "allow" : "reject"))
  if (option) useChatStore.getState().respondPermission(edit.chatId, edit.requestId, option.optionId)
}

// A selected passage goes to the agent window: Ask waits for the question, the others send at once
function runSelection(fileId: string, action: SelectionAction, text: string) {
  const file = useDocsStore.getState().files[fileId]
  if (!file) return
  const source = docMentionable(file)
  const win = useAgentWindow.getState()
  if (action === "ask") return win.open({ text, source })
  useAgentWindow.setState({ selection: { text, source } })
  const ask = action === "rewrite" ? "Rewrite this passage." : "Find support for this passage."
  win.send({ text: ask, mentions: [], attachments: [] }, win.hiddenContext === source.uri ? [] : [source])
}

const SAVE_DELAY = 300

// Where each doc was left, for this session: a doc reopens with the cursor where it was
const lastSelection = new Map<string, EditorSelection>()

export function DocEditor({ file }: { file: WorkspaceFile }) {
  const host = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  // One editor per doc. Its text is the file's text; every change is written back shortly after typing stops.
  useEffect(() => {
    const id = file.id
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: string | null = null
    const flush = () => {
      clearTimeout(timer)
      if (pending !== null) useDocsStore.getState().writeDoc(id, pending)
      pending = null
    }

    const content = file.content ?? ""
    const saved = lastSelection.get(id)
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        selection: saved && saved.main.head <= content.length ? saved : undefined,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, extensions: [Highlight] }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Doc text" }),
          placeholder("Start writing"),
          docTheme,
          docHighlight,
          livePreview({
            describe: mentionTitle,
            onOpenMention: (uri) => {
              const to = mentionRoute(uri)
              if (to) navigateRef.current(to)
            },
          }),
          mentionPopup((query) => docMentionItems(query, id)),
          selectionMenu((action, text) => runSelection(id, action, text)),
          agentSuggestions(respondToEdit),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) lastSelection.set(id, u.state.selection)
            if (!u.docChanged) return
            pending = u.state.doc.toString()
            clearTimeout(timer)
            timer = setTimeout(flush, SAVE_DELAY)
          }),
        ],
      }),
    })

    // A new doc starts with the cursor in it; a doc opened again picks up where it was left
    if (!content || saved) {
      view.focus()
      if (saved) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) })
    }

    // Agent writes to this doc go through the editor; edits the agent proposes for it are drawn in place
    const unregister = registerEditor(id, view)
    let shown: PendingEdit[] = []
    const syncEdits = () => {
      const path = useDocsStore.getState().files[id]?.path
      const edits = path ? pendingEdits(useChatStore.getState().chats, path) : []
      if (edits.length === shown.length && edits.every((e, i) => e.requestId === shown[i].requestId)) return
      shown = edits
      view.dispatch({ effects: setPendingEdits.of(edits) })
    }
    syncEdits()
    const unsubscribe = useChatStore.subscribe(syncEdits)

    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
      flush()
      unsubscribe()
      unregister()
      view.destroy()
      // Checked after the route settles, so a remount of the same doc doesn't count as leaving it
      setTimeout(() => {
        const left = useDocsStore.getState().files[id]
        if (left && !left.content && freshDocIds.has(id) && !window.location.pathname.endsWith(`/docs/${id}`)) {
          useDocsStore.getState().deleteFile(id)
          freshDocIds.delete(id)
        }
      })
    }
    // The editor owns the text while it is open; it is rebuilt only for another doc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id])

  return <div ref={host} className="min-h-full" />
}
