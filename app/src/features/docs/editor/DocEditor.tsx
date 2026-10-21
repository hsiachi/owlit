import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { Compartment, EditorSelection, EditorState, type Transaction } from "@codemirror/state"
import { EditorView, keymap, placeholder } from "@codemirror/view"
import { useAgentWindow } from "@/features/agent/store"
import { useChatStore } from "@/features/chat/store"
import { undoAll, undoSteps } from "@/lib/changes"
import { reportDocEdited } from "@/app/activity"
import { markDocEdit } from "@/features/home/trail"
import { leftMissingDoc } from "../disk"
import { registerEditor } from "../editors"
import { wikilinkFile } from "../fs"
import { allDocMentions, docMentionable, docUriOfLink, mentionTooltip, openMention, paperUnread } from "../lib/mentions"
import { paperById, useLibraryStore } from "@/features/library/store"
import { BESIDE_MIN_WINDOW, useBeside } from "@/features/agent/beside"
import { freshDocIds, useDocsStore } from "../store"
import { displayName, type CommentAnchor, type WorkspaceFile } from "../types"
import { livePreview } from "./live-preview"
import { DocCitationHover } from "./citation-hover"
import { mentionPopup } from "./mention-popup"
import { useDocsUiStore } from "../ui-store"
import { commentMarks, commentSpots, setComments, setNewComment, setOpenComment } from "./comment-marks"
import { commentViews } from "../comments/model"
import { setCommentSlot, setCommentTops } from "../comments/layout"
import { selectionMenu } from "./selection-menu"
import { askOwlitOnRightClick, isPassage } from "@/app/text-menu"
import { blockPreview } from "./block-preview"
import { changedSince } from "./changed-since"
import { proposalMarks } from "./proposals"
import { followChangedSince } from "../changed"
import { Highlight, MathSyntax, Wikilinks } from "./syntax"
import { docHighlight, docTheme } from "./theme"
import "katex/dist/katex.min.css"
import { routeSubject } from "@/app/route-subject"
import { anchorAt, parseOwlitUri } from "@owlit/protocol"
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

// A paper's citation opens the paper beside the doc, when the window is wide enough and the paper is in
// the Library (one a thread only found has no reader); false when it should open as it always did
function openBeside(uri: string, quote: string | undefined, from: { docId: string; pos: number }) {
  const u = parseOwlitUri(uri)
  if (u?.kind !== "paper" || window.innerWidth < BESIDE_MIN_WINDOW) return false
  const { papers, aliases } = useLibraryStore.getState()
  const paper = paperById(papers, aliases, u.id)
  if (!paper) return false
  useBeside.getState().open({ paperId: paper.id, ...(u.page ? { page: u.page } : {}), ...(quote ? { quote } : {}), from })
  return true
}

// Where each doc was left, for this session: a doc reopens with the cursor where it was, scrolled as it
// was (Back from a paper a citation opened lands on the citation, not on the cursor)
const lastSelection = new Map<string, EditorSelection>()
const lastScroll = new Map<string, number>()

// What scrolls the doc: the page around the editor, which grows with its text
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p
  return null
}

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
    let seen: ReturnType<typeof followChangedSince> | undefined

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
          // Tab indents in the text; after Esc it moves to what can be acted on in it (a passage's Undo,
          // a citation) for a moment, so the keyboard isn't trapped in the editor. Esc goes on to whatever
          // else listens for it (a comment's card, the paper beside the doc).
          keymap.of([
            {
              key: "Escape",
              run: (v) => {
                v.setTabFocusMode(2000)
                return false
              },
            },
          ]),
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
            // A paper read meanwhile (or renamed) shows at once in the doc's mentions; a doc made or renamed
            // meanwhile makes the wikilinks and path links that name it live
            resolversChange: (changed) => {
              const stops = [
                useLibraryStore.subscribe((s, prev) => {
                  if (s.papers !== prev.papers) changed()
                }),
                useDocsStore.subscribe((s, prev) => {
                  if (s.files !== prev.files) changed()
                }),
              ]
              return () => stops.forEach((stop) => stop())
            },
            wikilink: wikilinkRoute,
            docLink: docUriOfLink,
            // A citation's sentence goes with it, so the paper opens with it ringed: beside the doc when the
            // window has room for both, else (or with ⌘) on its own page
            onOpenMention: (uri, quote, { meta, pos }) => {
              if (!meta && openBeside(uri, quote, { docId: id, pos })) return
              openMention(uri, (to) => navigateRef.current(to), window.location.pathname, quote)
            },
            onOpenRoute: (route) => navigateRef.current(route),
          }),
          mentionPopup(() => allDocMentions(id)),
          selectionMenu(
            (text, view) => chatAbout(id, text, view.state.selection.main.from),
            (view) => startComment(id, view),
          ),
          keymap.of([{ key: "Mod-Alt-m", run: (view) => startComment(id, view) }]),
          changedSince,
          proposalMarks({
            undo: (steps) => {
              const name = displayName(useDocsStore.getState().files[id]?.path ?? "")
              void undoSteps(steps, name)
            },
            chatTitle: (chatId) => useChatStore.getState().chats[chatId]?.title,
            openChat: (chatId) => useAgentWindow.getState().showChat(chatId),
            undoWhole: (p) => {
              const name = displayName(useDocsStore.getState().files[id]?.path ?? "")
              void undoAll([...(p.whole?.also ?? []).toReversed(), p.id], name)
            },
            clear: () => seen?.clear(),
          }),
          commentMarks({
            onOpen: (key) => useDocsUiStore.getState().setOpenComment(id, key),
            onLayout: (tops) => setCommentTops(id, tops),
            onSlot: (el, was) => setCommentSlot(id, el, was),
          }),
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) lastSelection.set(id, u.state.selection)
            if (!u.docChanged) return
            seen?.changed()
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

    // What others changed since the user last had it on screen, and marking it seen
    const diskText = () => (crlf ? view.state.doc.toString().replace(/\n/g, "\r\n") : view.state.doc.toString())
    seen = followChangedSince(view, () => useDocsStore.getState().files[id]?.path, diskText)

    // A new doc starts with the cursor in it; a doc opened again picks up where it was left: scrolled as it
    // was when that is known, else with the cursor in the middle
    const scroller = scrollerOf(view.dom)
    const scrolled = lastScroll.get(id)
    if (!content || saved) {
      view.focus()
      if (saved && (scrolled === undefined || !scroller)) view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }) })
    }
    // After the first layout, when the doc is as tall as it was
    if (scroller && scrolled !== undefined) requestAnimationFrame(() => scroller.scrollTo({ top: scrolled }))
    const keepScroll = () => lastScroll.set(id, scroller!.scrollTop)
    scroller?.addEventListener("scroll", keepScroll, { passive: true })

    // Agent writes to this doc go through the editor
    const unregister = registerEditor(id, view)

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
      scroller?.removeEventListener("scroll", keepScroll)
      unregisterAsk()
      flush()
      unsubscribeOwn()
      unsubscribeReaders()
      unsubscribeOpen()
      unsubscribeMissing()
      unregister()
      seen.close()
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

  return (
    <>
      <div ref={host} className="min-h-full" />
      <DocCitationHover host={host} />
    </>
  )
}
