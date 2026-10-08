import { useEffect } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { toast } from "sonner"
import { useReaderStore } from "../reader/reader-store"
import { useLibraryStore } from "../store"
import { NoteMention } from "./note-mention"
import { consumeFocusEnd } from "./note-actions"

const HIGHLIGHT_LINK = "owlit://highlight/"

// One note per paper, kept as Markdown. Markdown shortcuts as you type (#, -, >, **), @ to
// mention a paper, doc or knowledge item. Saved on every change; nothing says "saved".
export function NoteEditor({ paperId }: { paperId: string }) {
  const setNote = useLibraryStore((s) => s.setNote)

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

  // The note has no box: the panel is its page. The empty space below the text is still the
  // note, so a click anywhere there puts the cursor at the end.
  return (
    <div
      className="min-h-64 flex-1 cursor-text pb-16"
      onMouseDown={(e) => {
        if (e.target !== e.currentTarget || !editor) return
        e.preventDefault()
        editor.commands.focus("end")
      }}
    >
      <EditorContent editor={editor} />
    </div>
  )
}
