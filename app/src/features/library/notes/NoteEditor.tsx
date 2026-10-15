import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { toast } from "sonner"
import { askOwlitOnRightClick, isPassage } from "@/app/text-menu"
import { respondToEdit } from "@/features/chat/lib/respond-edit"
import { drawnEdits } from "@/features/chat/in-place"
import { subscribePendingEdits, type PendingEdit } from "@/features/chat/pending-edits"
import { useSelectionMenu } from "@/components/selection-menu"
import { askAboutPassage } from "../actions"
import { showInPaper } from "../paper-view"
import { useLibraryStore } from "../store"
import { NoteMention } from "./note-mention"
import { consumeFocusEnd, notePathOf } from "./note-actions"
import { NoteSuggestions, noteSuggestionsKey } from "./note-suggestions"

const HIGHLIGHT_LINK = "owlit://highlight/"

// Moving to another paper recreates the editor (useEditor's deps), and useEditor destroys the old one in its
// own effect. Effects that depend on paperId then run once more in that same commit with the old editor, whose
// view is gone (view.dom throws). They skip it: the next render brings the new editor and runs them again.
const live = (editor: Editor | null): editor is Editor => !!editor && !editor.isDestroyed

// One note per paper, kept as Markdown. Markdown shortcuts as you type (#, -, >, **), @ to
// mention a paper, doc or collection. Saved on every change; nothing says "saved".
// The note is the user's, so Owlit works on it as on a doc: a selection offers "Ask Owlit",
// and an edit Owlit proposes is shown in the note before anything changes.
export function NoteEditor({ paperId }: { paperId: string }) {
  const setNote = useLibraryStore((s) => s.setNote)
  const box = useRef<HTMLDivElement>(null)
  const { menu, control: selectionMenu } = useSelectionMenu(() => chat())
  // The Markdown this editor last saved, so hearing its own change back costs no second getMarkdown()
  const written = useRef<string | undefined>(undefined)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // owlit:// links are a quote's way back to its highlight
          link: { openOnClick: false, autolink: true, protocols: ["owlit"] },
        }),
        Markdown,
        Placeholder.configure({ placeholder: t`What do you take from this paper?` }),
        NoteMention,
        NoteSuggestions.configure({ respond: (edit: PendingEdit, apply: boolean) => respondToEdit(edit.chatId, edit.requestId, apply) }),
      ],
      content: useLibraryStore.getState().notes[paperId]?.content ?? "",
      contentType: "markdown",
      onUpdate: ({ editor }) => {
        written.current = editor.isEmpty ? "" : editor.getMarkdown()
        setNote(paperId, written.current)
      },
      editorProps: {
        attributes: { class: "note-editor markdown text-body leading-relaxed outline-none" },
        handleClick: (_view, _pos, event) => {
          const a = event.target instanceof HTMLElement ? event.target.closest("a") : null
          const href = a?.getAttribute("href") ?? ""
          if (!href.startsWith(HIGHLIGHT_LINK)) return false
          const h = useLibraryStore.getState().highlights[href.slice(HIGHLIGHT_LINK.length)]
          if (h) showInPaper(h.paperId, { highlight: h }).catch(() => undefined)
          else toast(t`That highlight was deleted`)
          return true
        },
      },
    },
    [paperId],
  )

  // Arriving from "Add to note": put the cursor after what was just added
  useEffect(() => {
    if (!live(editor) || !consumeFocusEnd(paperId)) return
    editor.commands.focus("end", { scrollIntoView: true })
  }, [editor, paperId])

  // The note changed outside this editor (an applied Owlit edit, another window, another program): it is
  // taken in as one change, so ⌘Z takes it back
  useEffect(() => {
    if (!live(editor)) return
    written.current = undefined
    return useLibraryStore.subscribe((state, prev) => {
      const next = state.notes[paperId]?.content ?? ""
      if (next === (prev.notes[paperId]?.content ?? "") || next === written.current) return
      const shown = editor.isEmpty ? "" : editor.getMarkdown()
      // From here on the editor shows `next`, or the same words
      written.current = next
      if (next.trim() === shown.trim()) return
      editor.commands.setContent(next, { contentType: "markdown", emitUpdate: false })
    })
  }, [editor, paperId])

  // Edits Owlit is waiting on for this note, from any chat
  useEffect(() => {
    if (!live(editor)) return
    const path = notePathOf(paperId)
    // Owlit's proposed edits to this note are answered here, so the chat's card points at the note. The
    // note draws every one: what it can't place goes at its end.
    const setDrawn = drawnEdits()
    const unsubscribe = subscribePendingEdits(
      () => path,
      (edits) => {
        editor.view.dispatch(editor.state.tr.setMeta(noteSuggestionsKey, edits))
        setDrawn(edits.map((e) => e.requestId))
      },
    )
    return () => {
      unsubscribe()
      setDrawn([])
    }
  }, [editor, paperId])

  // A selected passage offers one action above it, "Ask Owlit"; not while the mouse is still choosing
  useEffect(() => {
    if (!editor) return
    const place = () => {
      const { from, to, empty } = editor.state.selection
      const text = empty ? "" : editor.state.doc.textBetween(from, to, "\n").trim()
      if (mouse.choosing() || !editor.isFocused || !isPassage(text) || !box.current) return selectionMenu.hide()
      const outer = box.current.getBoundingClientRect()
      // On the note's first lines there is no room above without covering the tabs: it goes under the selection
      selectionMenu.show(outer, editor.view.coordsAtPos(from), () => editor.view.coordsAtPos(to).bottom, outer.top)
    }
    const mouse = selectionMenu.watch(editor.view.dom, place)
    editor.on("selectionUpdate", place)
    editor.on("blur", place)
    return () => {
      mouse.stop()
      editor.off("selectionUpdate", place)
      editor.off("blur", place)
    }
  }, [editor, selectionMenu])

  const chat = () => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, "\n").trim()
    if (!text) return
    selectionMenu.hide()
    askAboutPassage(paperId, { text, notePath: notePathOf(paperId) })
  }

  // A right-click on a selected passage starts the system's text menu with "Ask Owlit" too
  useEffect(() => {
    if (!live(editor)) return
    return askOwlitOnRightClick(editor.view.dom, () => {
      const { from, to, empty } = editor.state.selection
      return empty || !isPassage(editor.state.doc.textBetween(from, to, "\n")) ? null : chat
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, paperId])

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
      {menu}
    </div>
  )
}
