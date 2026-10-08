import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { EditorSelection, EditorState } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { docMentionItems, mentionRoute, mentionTitle } from "../lib/mentions"
import { freshDocIds, useDocsStore } from "../store"
import type { WorkspaceFile } from "../types"
import { livePreview } from "./live-preview"
import { mentionPopup } from "./mention-popup"
import { Highlight } from "./syntax"
import { docHighlight, docTheme } from "./theme"

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

    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
      flush()
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
