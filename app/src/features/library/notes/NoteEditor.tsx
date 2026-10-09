import { useEffect, useRef, useState } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { toast } from "sonner"
import { useAgentWindow } from "@/features/agent/store"
import { respondToEdit } from "@/features/chat/lib/respond-edit"
import { useChatStore } from "@/features/chat/store"
import { useShowsEditsInPlace } from "@/features/chat/in-place"
import { pendingEdits, type PendingEdit } from "@/features/docs/editor/suggestions"
import { cn } from "@/lib/utils"
import { paperMentionable } from "@/features/docs/lib/mentions"
import { useReaderStore } from "../reader/reader-store"
import { useLibraryStore } from "../store"
import { NoteMention } from "./note-mention"
import { consumeFocusEnd, notePathOf } from "./note-actions"
import { NoteSuggestions, noteSuggestionsKey } from "./note-suggestions"

const HIGHLIGHT_LINK = "owlit://highlight/"
// Clear of the selected line, as the Docs selection menu sits
const MENU_GAP = 8
// The menu's one 24px row in its 2px frame and hairline border
const MENU_HEIGHT = 30

// One note per paper, kept as Markdown. Markdown shortcuts as you type (#, -, >, **), @ to
// mention a paper, doc or knowledge item. Saved on every change; nothing says "saved".
// The note is the user's, so Owlit works on it as on a doc: a selection offers "Ask Owlit",
// and an edit Owlit proposes is shown in the note before anything changes.
export function NoteEditor({ paperId }: { paperId: string }) {
  const setNote = useLibraryStore((s) => s.setNote)
  const box = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ left: number; top: number; below: boolean } | null>(null)
  // Owlit's proposed edits to this note are answered here, so the chat's card points at the note
  useShowsEditsInPlace(notePathOf(paperId))

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // owlit:// links are a quote's way back to its highlight
          link: { openOnClick: false, autolink: true, protocols: ["owlit"] },
        }),
        Markdown,
        Placeholder.configure({ placeholder: "What do you take from this paper?" }),
        NoteMention,
        NoteSuggestions.configure({ respond: (edit: PendingEdit, apply: boolean) => respondToEdit(edit.chatId, edit.requestId, apply) }),
      ],
      content: useLibraryStore.getState().notes[paperId]?.content ?? "",
      contentType: "markdown",
      onUpdate: ({ editor }) => setNote(paperId, editor.isEmpty ? "" : editor.getMarkdown()),
      editorProps: {
        attributes: { class: "note-editor markdown text-[15px] leading-relaxed outline-none" },
        handleClick: (_view, _pos, event) => {
          const a = event.target instanceof HTMLElement ? event.target.closest("a") : null
          const href = a?.getAttribute("href") ?? ""
          if (!href.startsWith(HIGHLIGHT_LINK)) return false
          const h = useLibraryStore.getState().highlights[href.slice(HIGHLIGHT_LINK.length)]
          if (h) useReaderStore.getState().api?.jumpToHighlight(h)
          else toast("That highlight was deleted")
          return true
        },
      },
    },
    [paperId],
  )

  // Arriving from "Add to note": put the cursor after what was just added
  useEffect(() => {
    if (!editor || !consumeFocusEnd(paperId)) return
    editor.commands.focus("end", { scrollIntoView: true })
  }, [editor, paperId])

  // The note changed outside this editor (an applied Owlit edit, another window, another program): it is
  // taken in as one change, so ⌘Z takes it back
  useEffect(() => {
    if (!editor) return
    return useLibraryStore.subscribe((state, prev) => {
      const next = state.notes[paperId]?.content ?? ""
      if (next === (prev.notes[paperId]?.content ?? "")) return
      const shown = editor.isEmpty ? "" : editor.getMarkdown()
      if (next.trim() === shown.trim()) return
      editor.commands.setContent(next, { contentType: "markdown", emitUpdate: false })
    })
  }, [editor, paperId])

  // Edits Owlit is waiting on for this note, from any chat
  useEffect(() => {
    if (!editor) return
    const path = notePathOf(paperId)
    let shown: PendingEdit[] = []
    const sync = () => {
      const edits = pendingEdits(useChatStore.getState().chats, path)
      if (edits.length === shown.length && edits.every((e, i) => e.requestId === shown[i].requestId)) return
      shown = edits
      editor.view.dispatch(editor.state.tr.setMeta(noteSuggestionsKey, edits))
    }
    sync()
    return useChatStore.subscribe(sync)
  }, [editor, paperId])

  // A selected passage offers one action above it, "Ask Owlit"; not while the mouse is still choosing
  useEffect(() => {
    if (!editor) return
    let choosing = false
    const place = () => {
      const { from, to, empty } = editor.state.selection
      const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n").trim()
      if (choosing || !editor.isFocused || text.length < 3 || !box.current) return setMenu(null)
      const start = editor.view.coordsAtPos(from)
      const outer = box.current.getBoundingClientRect()
      const above = start.top - outer.top - MENU_GAP
      // On the note's first lines there is no room above without covering the tabs: it goes under the selection
      if (above - MENU_HEIGHT >= 0) return setMenu({ left: start.left - outer.left, top: above, below: false })
      const end = editor.view.coordsAtPos(to)
      setMenu({ left: start.left - outer.left, top: end.bottom - outer.top + MENU_GAP, below: true })
    }
    const down = () => {
      choosing = true
      setMenu(null)
      document.addEventListener(
        "mouseup",
        () => {
          choosing = false
          // After the release has settled the selection
          setTimeout(place)
        },
        { once: true },
      )
    }
    const dom = editor.view.dom
    dom.addEventListener("mousedown", down)
    editor.on("selectionUpdate", place)
    editor.on("blur", place)
    return () => {
      dom.removeEventListener("mousedown", down)
      editor.off("selectionUpdate", place)
      editor.off("blur", place)
    }
  }, [editor])

  const chat = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, "\n").trim()
    const paper = useLibraryStore.getState().papers[paperId]
    if (!paper || !text) return
    setMenu(null)
    useAgentWindow.getState().open({ text, source: paperMentionable(paper), notePath: notePathOf(paperId) })
  }

  // The note has no box: the panel is its page. The empty space below the text is still the
  // note, so a click anywhere there puts the cursor at the end.
  return (
    <div
      ref={box}
      className="relative min-h-64 flex-1 cursor-text pb-16"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget || !editor) return
        e.preventDefault()
        editor.commands.focus("end")
      }}
    >
      <EditorContent editor={editor} />
      {menu && (
        // The Docs selection menu: one compact row in a thin frame, covering as little text as it can
        <div
          className={cn("absolute z-20 flex rounded-[8px] border bg-popover p-0.5 text-[13px] shadow-lg", !menu.below && "-translate-y-full")}
          style={{ left: menu.left, top: menu.top }}
        >
          <button
            type="button"
            // Keep the selection and focus in the note while clicking
            onMouseDown={(e) => e.preventDefault()}
            onClick={chat}
            className="h-6 rounded-md px-2 hover:bg-accent"
          >
            Ask Owlit
          </button>
        </div>
      )}
    </div>
  )
}
