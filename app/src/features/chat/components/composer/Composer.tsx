import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Extension } from "@tiptap/core"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { ArrowUpIcon, PlusIcon, SquareIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { docMentionItems } from "@/features/docs/lib/mentions"
import { openSettings } from "@/features/settings/store"
import type { AttachmentFile, Mentionable, PromptInput, SourceKind } from "../../types"
import { sourceKindLabel } from "../source-icons"
import { AgentPicker, isUnavailable, useResolvedSelection } from "./AgentPicker"
import { AttachmentList } from "./AttachmentList"
import { mentionFilter, mentionPopup, WorkspaceMention } from "./mention-extension"

export interface ComposerHandle {
  focus: () => void
  setText: (text: string) => void
  // Insert "@" at the cursor with the popup pre-filtered to one source
  openMention: (kind: SourceKind | "all") => void
}

interface ComposerProps {
  chatId?: string
  onSubmit: (input: PromptInput) => void
  streaming?: boolean
  // What the running turn waits on the user for: what they type then answers it (see the store's send)
  waiting?: "permission" | "question"
  onCancel?: () => void
  autoFocus?: boolean
  placeholder?: string
  className?: string
  // Shown above the input, e.g. the agent window's context chips
  header?: React.ReactNode
}

// Enter submits, Shift+Enter inserts a line break. Runs before the core keymap
// (which would split the paragraph) and yields to the mention popup while open.
const SubmitKeymap = Extension.create<{ onSubmit: () => void }>({
  name: "submitKeymap",
  priority: 1000,
  addOptions: () => ({ onSubmit: () => {} }),
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        if (mentionPopup.open) return false
        this.options.onSubmit()
        return true
      },
      "Shift-Enter": () => this.editor.commands.setHardBreak(),
    }
  },
})

// Flatten the document into plain text plus the mentioned items
function extract(editor: Editor): { text: string; mentions: Mentionable[] } {
  const mentions: Mentionable[] = []
  const lines: string[] = []
  editor.state.doc.forEach((block) => {
    let line = ""
    block.descendants((node) => {
      if (node.type.name === "mention") {
        const m = docMentionItems("").find((x) => x.id === node.attrs.id && (!node.attrs.kind || x.kind === node.attrs.kind))
        if (m && !mentions.some((x) => x.id === m.id)) mentions.push(m)
        line += `@[${node.attrs.label}]`
      } else if (node.isText) {
        line += node.text
      } else if (node.type.name === "hardBreak") {
        line += "\n"
      }
      return true
    })
    lines.push(line)
  })
  return { text: lines.join("\n").trim(), mentions }
}

function toAttachment(file: File): AttachmentFile {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    mimeType: file.type,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  }
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { chatId, onSubmit, streaming = false, waiting, onCancel, autoFocus, placeholder = "Ask about your papers, docs or notes…", className, header },
  ref,
) {
  const [files, setFiles] = useState<AttachmentFile[]>([])
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const submitRef = useRef<() => void>(() => {})
  const { connector } = useResolvedSelection(chatId)
  const blocked = isUnavailable(connector)
  // The hint says what typing does while Owlit waits; read through a ref, since the editor is made once
  const hint = waiting === "permission" ? "Or tell Owlit what to do instead…" : waiting === "question" ? "Or type your own answer…" : placeholder
  const hintRef = useRef(hint)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        bold: false,
        italic: false,
        strike: false,
        code: false,
        link: false,
        underline: false,
        trailingNode: false,
        dropcursor: false,
        gapcursor: false,
      }),
      Placeholder.configure({ placeholder: () => hintRef.current }),
      WorkspaceMention,
      SubmitKeymap.configure({ onSubmit: () => submitRef.current() }),
    ],
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: { class: "tiptap-composer max-h-60 min-h-14 overflow-y-auto px-4 py-3.5 text-[15px] leading-6 outline-none" },
      handlePaste: (_view, event) => {
        const pasted = Array.from(event.clipboardData?.files ?? [])
        if (pasted.length === 0) return false
        setFiles((f) => [...f, ...pasted.map(toAttachment)])
        return true
      },
    },
  })

  const [isEmpty, setIsEmpty] = useState(true)
  useEffect(() => {
    if (!editor) return
    const update = () => setIsEmpty(editor.isEmpty)
    editor.on("update", update)
    return () => {
      editor.off("update", update)
    }
  }, [editor])

  // The placeholder is drawn by a decoration, redrawn on the next transaction
  useEffect(() => {
    hintRef.current = hint
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr)
  }, [editor, hint])

  const typed = !isEmpty || files.length > 0
  const canSend = (!streaming || !!waiting) && !blocked && typed

  const submit = useCallback(() => {
    if (!editor || !canSend) return
    const { text, mentions } = extract(editor)
    if (!text && files.length === 0) return
    onSubmit({ text, mentions, attachments: files })
    editor.commands.clearContent(true)
    setFiles([])
    setIsEmpty(true)
  }, [editor, canSend, files, onSubmit])
  useEffect(() => {
    submitRef.current = submit
  }, [submit])

  const openMention = (kind: SourceKind | "all") => {
    if (!editor) return
    mentionFilter.next = kind
    const { from } = editor.state.selection
    const before = from > 1 ? editor.state.doc.textBetween(from - 1, from) : ""
    const prefix = before && !/\s/.test(before) ? " @" : "@"
    editor.chain().focus().insertContent(prefix).run()
  }

  useImperativeHandle(ref, () => ({
    focus: () => editor?.commands.focus("end"),
    setText: (text) => {
      editor?.commands.setContent(text ? `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>` : "")
      setIsEmpty(!text)
      editor?.commands.focus("end")
      // HTML drops a trailing space, and a prompt stem ("Find recent papers on ") needs it to type on
      if (/ $/.test(text)) editor?.commands.insertContent(" ")
    },
    openMention,
  }))

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    setFiles((f) => [...f, ...Array.from(list).map(toAttachment)])
  }

  return (
    <div
      className={cn(
        "@container relative flex w-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-md",
        dragging && "border-ring ring-2 ring-ring/30",
        className,
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
    >
      {/* Only an agent that can't run gets a banner; a working one stays quiet */}
      {connector && blocked && (
        <button
          type="button"
          onClick={() => openSettings("agents")}
          className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1 truncate">
            {connector.name} {connector.status === "not_installed" ? "is not installed" : `can't be reached${connector.error ? ` · ${connector.error}` : ""}`}
          </span>
          <span className="shrink-0 font-medium text-foreground">Set up</span>
        </button>
      )}

      {header && <div className="flex flex-wrap gap-1 px-2.5 pt-2.5">{header}</div>}

      {files.length > 0 && (
        <div className="px-3 pt-3">
          <AttachmentList files={files} onRemove={(id) => setFiles((f) => f.filter((x) => x.id !== id))} />
        </div>
      )}

      {/* Click anywhere in the editor area to focus */}
      <div className="cursor-text" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" aria-label="Add attachments or context">
                  <PlusIcon />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Attach files or mention a paper, doc or note</TooltipContent>
          </Tooltip>
          {/* Keep focus in the editor after picking an item so the mention popup stays usable */}
          <DropdownMenuContent align="start" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
              Attach files
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {(["paper", "doc", "knowledge"] as SourceKind[]).map((kind) => (
              <DropdownMenuItem key={kind} onSelect={() => setTimeout(() => openMention(kind), 0)}>
                Add from {sourceKindLabel[kind]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ""
          }}
        />

        <div className="ml-auto flex items-center gap-1">
          <AgentPicker chatId={chatId} />
          {streaming && !(waiting && typed) ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" className="rounded-full" onClick={onCancel} aria-label="Stop generating">
                  <SquareIcon className="size-3 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop</TooltipContent>
            </Tooltip>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" className="rounded-full" disabled={!canSend} onClick={submit} aria-label="Send message">
                  <ArrowUpIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                Send <Kbd>↵</Kbd>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
})

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
