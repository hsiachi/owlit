import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { Compartment, EditorSelection, EditorState, type Transaction } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { useAgentWindow } from "@/features/agent/store"
import { drawnEdits } from "@/features/chat/in-place"
import { reportDocEdited } from "@/app/activity"
import { markDocEdit } from "@/features/home/trail"
import { leftMissingDoc } from "../disk"
import { registerEditor } from "../editors"
import { wikilinkFile } from "../fs"
import { allDocMentions, docMentionable, mentionTooltip, openMention, paperUnread } from "../lib/mentions"
import { useLibraryStore } from "@/features/library/store"
import { freshDocIds, useDocsStore } from "../store"
import { type CommentAnchor, type WorkspaceFile } from "../types"
import { livePreview } from "./live-preview"
import { mentionPopup } from "./mention-popup"
import { useDocsUiStore } from "../ui-store"
import { commentMarks, commentSpots, setComments, setNewComment, setOpenComment } from "./comment-marks"
import { commentViews } from "../comments/model"
import { setCommentSlot, setCommentTops } from "../comments/layout"
import { selectionMenu } from "./selection-menu"
import { askOwlitOnRightClick, isPassage } from "@/app/text-menu"
import { agentSuggestions, setPendingEdits } from "./suggestions"
import { subscribePendingEdits, type PendingEdit } from "@/features/chat/pending-edits"
import { blockPreview } from "./block-preview"
import { Highlight, MathSyntax, Wikilinks } from "./syntax"
import { docHighlight, docTheme } from "./theme"
import "katex/dist/katex.min.css"
import { respondToEdit as answerEdit } from "@/features/chat/lib/respond-edit"
import { routeSubject } from "@/app/route-subject"
import { anchorAt } from "@owlit/protocol"
import { useShareStore } from "../share/store"

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

// Starts a comment on the selected words: its card opens in the column, level with them
function startComment(fileId: string, view: EditorView) {
  const { from, to } = view.state.selection.main
  if (from === to || !isPassage(view.state.sliceDoc(from, to))) return false
  useDocsUiStore.getState().setNewComment({ docId: fileId, from, to })
  return true
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
    // What the next write owes: the text changed, and whether by the user's own hand. The text is read
    // and the user's place on Home's trail kept only then, not on every keystroke.
    let dirty = false
    let userEdited = false
    const content = file.content ?? ""
    const crlf = usesCrlf(content)
    const flush = () => {
      clearTimeout(timer)
      if (userEdited) {
        const path = useDocsStore.getState().files[id]?.path
        if (path) markDocEdit(path, view.state.selection.main.head)
      }
      if (dirty) {
        const text = view.state.doc.toString()
        useDocsStore.getState().writeDoc(id, crlf ? text.replace(/\n/g, "\r\n") : text)
        saveCommentPlaces()
      }
      dirty = userEdited = false
    }
    // Passages edited while the doc was open are saved as they read now, so their comments find them next time
    let saveCommentPlaces = () => {}
    // Owlit's proposed edits drawn in the doc are answered here, so the chat's card points at the doc
    const setDrawn = drawnEdits()

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
          EditorView.contentAttributes.of({ spellcheck: "true", "aria-label": t`Doc text` }),
          placeholder(t`Start writing`),
          docTheme,
          docHighlight,
          livePreview({
            describe: mentionTooltip,
            unread: (uri) => paperUnread(uri),
            // A paper read meanwhile (or renamed) shows at once in the doc's mentions
            resolversChange: (changed) =>
              useLibraryStore.subscribe((s, prev) => {
                if (s.papers !== prev.papers) changed()
              }),
            wikilink: wikilinkRoute,
            onOpenMention: (uri) => openMention(uri, (to) => navigateRef.current(to)),
            onOpenRoute: (route) => navigateRef.current(route),
          }),
          mentionPopup(() => allDocMentions(id)),
          selectionMenu(
            (text, view) => chatAbout(id, text, view.state.selection.main.from),
            (view) => startComment(id, view),
          ),
          keymap.of([{ key: "Mod-Alt-m", run: (view) => startComment(id, view) }]),
          agentSuggestions(respondToEdit, setDrawn),
          commentMarks({
            onOpen: (key) => useDocsUiStore.getState().setOpenComment(id, key),
            onLayout: (tops) => setCommentTops(id, tops),
            onSlot: (el, was) => setCommentSlot(id, el, was),
          }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) lastSelection.set(id, u.state.selection)
            if (!u.docChanged) return
            if (u.transactions.some(isUserEdit)) {
              reportDocEdited(id)
              userEdited = true
            }
            dirty = true
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
    const unsubscribe = subscribePendingEdits(
      () => useDocsStore.getState().files[id]?.path,
      (edits) => view.dispatch({ effects: setPendingEdits.of(edits) }),
    )

    const unsubscribeMissing = useDocsStore.subscribe((s) => {
      if (!!s.missing[id] === missing) return
      missing = !!s.missing[id]
      view.dispatch({ effects: editable.reconfigure(lock(missing)) })
    })

    // The doc's comments follow the stores: Owlit's and yours beside the file, readers' on the share link
    // (by the doc's path now)
    const ownNow = () => useDocsStore.getState().comments[id]
    const readersNow = () => useShareStore.getState().comments[useDocsStore.getState().files[id]?.path ?? ""]
    let own = ownNow()
    let readers = readersNow()
    view.dispatch({ effects: setComments.of(commentViews(own, readers)) })
    const refreshComments = () => {
      if (ownNow() === own && readersNow() === readers) return
      own = ownNow()
      readers = readersNow()
      view.dispatch({ effects: setComments.of(commentViews(own, readers)) })
    }
    const unsubscribeOwn = useDocsStore.subscribe(refreshComments)
    const unsubscribeReaders = useShareStore.subscribe(refreshComments)

    // Which comment is open, and the one being started, are shared with the column. Opening one from the
    // column scrolls only as far as it takes to show its words.
    const openFor = (s: ReturnType<typeof useDocsUiStore.getState>) => (s.openComment?.docId === id ? s.openComment.key : null)
    const draftFor = (s: ReturnType<typeof useDocsUiStore.getState>) => (s.newComment?.docId === id ? s.newComment : null)
    let open = openFor(useDocsUiStore.getState())
    let draft = draftFor(useDocsUiStore.getState())
    if (open) view.dispatch({ effects: setOpenComment.of(open) })
    const unsubscribeOpen = useDocsUiStore.subscribe((s) => {
      const next = openFor(s)
      const nextDraft = draftFor(s)
      if (nextDraft !== draft) {
        draft = nextDraft
        view.dispatch({ effects: setNewComment.of(draft ? { from: draft.from, to: draft.to } : null) })
      }
      if (next === open) return
      open = next
      view.dispatch({ effects: setOpenComment.of(next) })
      const spot = commentSpots(view.state).find((c) => c.item.key === next && !c.lost)
      if (spot) view.dispatch({ effects: EditorView.scrollIntoView(spot.from, { y: "nearest", yMargin: 120 }) })
    })

    saveCommentPlaces = () => {
      const doc = view.state.doc
      let text: string | undefined
      const moved: Record<string, CommentAnchor> = {}
      for (const s of commentSpots(view.state)) {
        if (s.lost || !s.item.doc || doc.sliceString(s.from, s.to) === s.item.doc.quote) continue
        moved[s.item.doc.id] = anchorAt((text ??= doc.toString()), s.from, s.to)
      }
      if (Object.keys(moved).length) useDocsStore.getState().reanchorComments(id, moved)
    }

    // A right-click on a selected passage starts the system's text menu with "Ask Owlit", as the floating
    // menu offers it
    const unregisterAsk = askOwlitOnRightClick(view.dom, () => {
      const { from, to } = view.state.selection.main
      const text = view.state.sliceDoc(from, to)
      return isPassage(text) ? () => chatAbout(id, text, from) : null
    })

    window.addEventListener("beforeunload", flush)
    return () => {
      window.removeEventListener("beforeunload", flush)
      unregisterAsk()
      flush()
      unsubscribe()
      setDrawn([])
      unsubscribeOwn()
      unsubscribeReaders()
      unsubscribeOpen()
      unsubscribeMissing()
      unregister()
      view.destroy()
      // Checked after the route settles, so a remount of the same doc doesn't count as leaving it
      setTimeout(() => {
        const left = useDocsStore.getState().files[id]
        const here = routeSubject(window.location.pathname)
        if (here?.kind === "doc" && here.id === id) return
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
