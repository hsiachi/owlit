import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { Compartment, EditorSelection, EditorState, type Transaction } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { toast } from "sonner"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "@/features/chat/store"
import { reportDocEdited } from "@/lib/activity"
import { leftMissingDoc } from "../disk"
import { registerEditor } from "../editors"
import { wikilinkFile } from "../fs"
import { docMentionable, docMentionItems, mentionRoute, mentionTitle } from "../lib/mentions"
import { freshDocIds, useDocsStore } from "../store"
import { type AgentNote, type WorkspaceFile } from "../types"
import { livePreview } from "./live-preview"
import { mentionPopup } from "./mention-popup"
import { useDocsUiStore } from "../ui-store"
import { agentNotes, noteSpots, setNotes, setOpenNote } from "./agent-notes"
import { selectionMenu } from "./selection-menu"
import { agentSuggestions, pendingEdits, setPendingEdits, type PendingEdit } from "./suggestions"
import { blockPreview } from "./block-preview"
import { Highlight, MathSyntax, Wikilinks } from "./syntax"
import { docHighlight, docTheme } from "./theme"
import "katex/dist/katex.min.css"
import { respondToEdit as answerEdit } from "@/features/chat/lib/respond-edit"

// A change the user made by hand. Agent writes come in as "input.agent", links that follow a rename
// carry no user event at all; neither is the user's edit.
const isUserEdit = (tr: Transaction) =>
  tr.docChanged &&
  !tr.isUserEvent("input.agent") &&
  ["input", "delete", "move", "undo", "redo"].some((event) => tr.isUserEvent(event))

// [[Name]] leads to the doc called Name (or at that path), wherever it is in the workspace
function wikilinkRoute(name: string) {
  const file = wikilinkFile(useDocsStore.getState().files, name)
  return file ? `/docs/${file.id}` : null
}

// Apply and Discard answer the agent's permission request with its allow-once or reject-once option
function respondToEdit(edit: PendingEdit, apply: boolean) {
  answerEdit(edit.chatId, edit.requestId, apply)
}

// A selected passage goes to the agent window, which waits for the question; `from` says which occurrence
function chatAbout(fileId: string, text: string, from?: number) {
  const file = useDocsStore.getState().files[fileId]
  if (file) useAgentWindow.getState().open({ text, source: docMentionable(file), from })
}

// Dismissing a note moves on to the next one, so a review can be worked through in one go
function dismissNote(fileId: string, note: AgentNote, next: string | null) {
  useDocsUiStore.getState().setOpenNote(fileId, next)
  const removed = useDocsStore.getState().removeNote(fileId, note.id)
  if (removed) toast("Note dismissed", { action: { label: "Undo", onClick: () => useDocsStore.getState().restoreNote(fileId, removed) } })
}

const SAVE_DELAY = 300

// The editor works in "\n" lines; a file written with "\r\n" throughout gets them back on save. Any other
// mix keeps its "\r"s as characters in the text, so they are written back exactly where they were.
const usesCrlf = (text: string) => text.includes("\r\n") && !/(^|[^\r])\n|\r(?!\n)/.test(text)

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
    const content = file.content ?? ""
    const crlf = usesCrlf(content)
    const flush = () => {
      clearTimeout(timer)
      if (pending !== null) {
        useDocsStore.getState().writeDoc(id, pending)
        saveNotePlaces()
      }
      pending = null
    }
    // Passages edited while the doc was open are saved as they read now, so their notes find them next time
    let saveNotePlaces = () => {}

    const saved = lastSelection.get(id)
    // A doc deleted on disk while open can still be read and copied, not edited
    const editable = new Compartment()
    const lock = (missing: boolean) => [EditorState.readOnly.of(missing), EditorView.editable.of(!missing)]
    let missing = !!useDocsStore.getState().missing[id]
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: content,
        selection: saved && saved.ranges.every((r) => r.to <= content.length) ? saved : undefined,
        extensions: [
          crlf ? [] : EditorState.lineSeparator.of("\n"),
          editable.of(lock(missing)),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage, extensions: [Highlight, Wikilinks, MathSyntax] }),
          blockPreview,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": "Doc text" }),
          placeholder("Start writing"),
          docTheme,
          docHighlight,
          livePreview({
            describe: mentionTitle,
            wikilink: wikilinkRoute,
            onOpenMention: (uri) => {
              const to = mentionRoute(uri)
              if (to) navigateRef.current(to)
            },
            onOpenRoute: (route) => navigateRef.current(route),
          }),
          mentionPopup((query) => docMentionItems(query, id)),
          selectionMenu((text, view) => chatAbout(id, text, view.state.selection.main.from)),
          agentSuggestions(respondToEdit),
          agentNotes({
            onOpen: (noteId) => useDocsUiStore.getState().setOpenNote(id, noteId),
            onChat: (note) => {
              useDocsUiStore.getState().setOpenNote(id, null)
              chatAbout(id, note.quote, noteSpots(view.state).find((s) => s.note.id === note.id && !s.lost)?.from)
            },
            onDismiss: (note, next) => dismissNote(id, note, next),
          }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) lastSelection.set(id, u.state.selection)
            if (!u.docChanged) return
            if (u.transactions.some(isUserEdit)) reportDocEdited(id)
            pending = crlf ? u.state.doc.toString().replace(/\n/g, "\r\n") : u.state.doc.toString()
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

    const unsubscribeMissing = useDocsStore.subscribe((s) => {
      if (!!s.missing[id] === missing) return
      missing = !!s.missing[id]
      view.dispatch({ effects: editable.reconfigure(lock(missing)) })
    })

    // The doc's margin notes follow the store
    let notes = useDocsStore.getState().notes[id]
    view.dispatch({ effects: setNotes.of(notes ?? []) })
    const unsubscribeNotes = useDocsStore.subscribe((s) => {
      if (s.notes[id] === notes) return
      notes = s.notes[id]
      view.dispatch({ effects: setNotes.of(notes ?? []) })
    })
    saveNotePlaces = () => {
      const doc = view.state.doc
      const moved: Record<string, Pick<AgentNote, "quote" | "prefix" | "suffix">> = {}
      for (const s of noteSpots(view.state)) {
        const quote = doc.sliceString(s.from, s.to)
        if (s.lost || quote === s.note.quote) continue
        moved[s.note.id] = { quote, prefix: doc.sliceString(Math.max(0, s.from - 32), s.from), suffix: doc.sliceString(s.to, s.to + 32) }
      }
      if (Object.keys(moved).length) useDocsStore.getState().reanchorNotes(id, moved)
    }

    // Which note is open is shared with the header's note count. Opening one scrolls only as far as it
    // takes to show the note, so a note opened from the text it sits under doesn't move the page.
    const openFor = (s: ReturnType<typeof useDocsUiStore.getState>) => (s.openNote?.docId === id ? s.openNote.noteId : null)
    let open = openFor(useDocsUiStore.getState())
    if (open) view.dispatch({ effects: setOpenNote.of(open) })
    const unsubscribeOpen = useDocsUiStore.subscribe((s) => {
      const next = openFor(s)
      if (next === open) return
      open = next
      view.dispatch({ effects: setOpenNote.of(next) })
      const spot = noteSpots(view.state).find((n) => n.note.id === next)
      // Room below the passage's last line for the card
      if (spot) view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.lineAt(spot.to).to, { y: "nearest", yMargin: 160 }) })
    })

    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
      flush()
      unsubscribe()
      unsubscribeNotes()
      unsubscribeOpen()
      unsubscribeMissing()
      unregister()
      view.destroy()
      // Checked after the route settles, so a remount of the same doc doesn't count as leaving it
      setTimeout(() => {
        const left = useDocsStore.getState().files[id]
        if (window.location.pathname.endsWith(`/docs/${id}`)) return
        if (left && !left.content && freshDocIds.has(id)) {
          useDocsStore.getState().deleteFile(id)
          freshDocIds.delete(id)
        }
        leftMissingDoc(id)
      })
    }
    // The editor owns the text while it is open; it is rebuilt only for another doc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id])

  return <div ref={host} className="min-h-full" />
}
