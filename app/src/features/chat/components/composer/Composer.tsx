import { t } from "@lingui/core/macro"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react"
import { Extension } from "@tiptap/core"
import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extensions"
import { ArrowUpIcon, PlusIcon, SquareIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tip } from "@/components/tip"
import { KIND_PLACE } from "@/lib/kinds"
import { docMentionItems, type DocMention } from "@/features/docs/lib/mentions"
import { openSettings } from "@/features/settings/store"
import { useFileDrop } from "@/hooks/use-file-drop"
import { fromDrop, openAttached, readerOf, useAttachments } from "../../lib/attachments"
import type { Mentionable, PromptInput, SourceKind } from "../../types"
import { useResolvedSelection } from "../../use-selection"
import { useComposerDrafts, useDraftKey } from "../../composer-drafts"
import { AgentPicker } from "./AgentPicker"
import { isUnavailable, problemSentence } from "../../lib/connector-status"
import { AttachmentList } from "./AttachmentList"
import { LargeFilesDialog } from "./LargeFilesDialog"
import { mentionFilter, mentionPopup, WorkspaceMention } from "./mention-extension"

export interface ComposerHandle {
  focus: () => void
  setText: (text: string) => void
  // Insert "@" at the cursor with the popup pre-filtered to one source
  openMention: (kind: SourceKind | "all") => void
}

export interface ComposerProps {
  chatId?: string
  // chatId is the chat sent to; without one (a new chat) the composer names the id the chat is to get,
  // since files attached before sending are already copied into that chat's folder
  onSubmit: (input: PromptInput, chatId: string) => void
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

// How long typing rests before the draft is written
const SAVE_AFTER_MS = 300

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

// Flatten the document into plain text plus the mentioned items. `known` holds mentions that @ doesn't
// offer (a workspace file that isn't Markdown, made a mention by attaching it).
function extract(editor: Editor, known: Mentionable[] = []): { text: string; mentions: Mentionable[] } {
  const mentions: Mentionable[] = []
  const lines: string[] = []
  const offered = docMentionItems("")
  editor.state.doc.forEach((block) => {
    let line = ""
    block.descendants((node) => {
      if (node.type.name === "mention") {
        const same = (x: Mentionable) => x.id === node.attrs.id && (!node.attrs.kind || x.kind === node.attrs.kind)
        const m = offered.find(same) ?? known.find(same)
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

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { chatId, onSubmit, streaming = false, waiting, onCancel, autoFocus, placeholder = t`Ask about your papers, docs or notes…`, className, header },
  ref,
) {
  // What is typed waits with its chat (composer-drafts); a new chat's draft is the same in every place
  const key = useDraftKey(chatId)
  const keyRef = useRef(key)
  // A new chat's id, named before it exists so attached files can be copied into its folder
  const newId = useComposerDrafts((s) => s.newId)
  const target = chatId ?? newId
  const insertRef = useRef<(m: DocMention, key: string) => void>(() => {})
  const attachments = useAttachments(key, target, (m, k) => insertRef.current(m, k))
  const files = attachments.files
  const { dragging, dropProps } = useFileDrop((data) => {
    const { files: dropped, folders } = fromDrop(data)
    attachments.add(dropped, folders)
  })
  const fileInput = useRef<HTMLInputElement>(null)
  const submitRef = useRef<() => void>(() => {})
  const { connector } = useResolvedSelection(chatId)
  const blocked = isUnavailable(connector)
  // The hint says what typing does while Owlit waits; read through a ref, since the editor is made once
  const hint = waiting === "permission" ? t`Or tell Owlit what to do instead…` : waiting === "question" ? t`Or type your own answer…` : placeholder
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
      attributes: { class: "tiptap-composer max-h-60 min-h-14 overflow-y-auto px-4 py-3.5 text-body leading-6 outline-none" },
      handlePaste: (_view, event) => {
        const pasted = Array.from(event.clipboardData?.files ?? [])
        if (pasted.length === 0) return false
        addRef.current(pasted)
        return true
      },
    },
  })

  const [isEmpty, setIsEmpty] = useState(true)
  // Kept as it is typed, so nothing is lost however the composer goes (another chat, another page). The
  // draft is written a moment after typing stops, not per key (the document as JSON, then localStorage),
  // and at once whenever the composer goes: another chat, unmounting, sending, the window closing.
  const pending = useRef<number | undefined>(undefined)
  const write = useCallback(() => {
    window.clearTimeout(pending.current)
    pending.current = undefined
    if (!editor || editor.isDestroyed) return
    useComposerDrafts.getState().put(keyRef.current, editor.isEmpty ? { doc: undefined, mentions: [] } : { doc: editor.getJSON() })
  }, [editor])
  // Only what was typed since the last write: with nothing waiting the stored draft is the newer one
  const flush = useCallback(() => {
    if (pending.current !== undefined) write()
  }, [write])
  const save = useCallback(() => {
    if (!editor || editor.isDestroyed) return
    setIsEmpty(editor.isEmpty)
    window.clearTimeout(pending.current)
    pending.current = window.setTimeout(write, SAVE_AFTER_MS)
  }, [editor, write])
  useEffect(() => {
    if (!editor) return
    editor.on("update", save)
    window.addEventListener("pagehide", flush)
    window.addEventListener("beforeunload", flush)
    return () => {
      editor.off("update", save)
      window.removeEventListener("pagehide", flush)
      window.removeEventListener("beforeunload", flush)
      flush()
    }
  }, [editor, save, flush])

  // Another chat in the same composer (the Chat page and the panel keep theirs from chat to chat): the last
  // one's draft is written, then its own comes in
  useEffect(() => {
    flush()
    keyRef.current = key
    if (!editor || editor.isDestroyed) return
    editor.commands.setContent(useComposerDrafts.getState().drafts[key]?.doc ?? "", { emitUpdate: false })
    setIsEmpty(editor.isEmpty)
    if (editor.isFocused) editor.commands.focus("end")
  }, [editor, key, flush])

  // The placeholder is drawn by a decoration, redrawn on the next transaction
  useEffect(() => {
    hintRef.current = hint
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr)
  }, [editor, hint])

  // A file attached is a mention at the cursor when owlit already has it (a doc, a Library paper); at the end
  // of its draft when the person has moved to another chat or page while it was being copied
  insertRef.current = (m, k) => {
    const drafts = useComposerDrafts.getState()
    drafts.put(k, { mentions: [...(drafts.drafts[k]?.mentions ?? []), m] })
    const nodes = [{ type: "mention", attrs: { id: m.id, label: m.label, kind: m.kind } }, { type: "text", text: " " }]
    if (editor && !editor.isDestroyed && k === keyRef.current) editor.chain().focus().insertContent(nodes).run()
    else drafts.append(k, nodes)
  }
  const addRef = useRef(attachments.add)
  addRef.current = attachments.add

  const ready = files.some((f) => f.state === "ready")
  const typed = !isEmpty || ready
  // A file still being copied holds Send for a moment, so the message never goes without it
  const canSend = (!streaming || !!waiting) && !blocked && typed && !attachments.adding

  const submit = useCallback(() => {
    if (!editor || !canSend) return
    const { text, mentions } = extract(editor, useComposerDrafts.getState().drafts[key]?.mentions)
    if (!text && !ready) return
    onSubmit({ text, mentions, attachments: attachments.take() }, target)
    editor.commands.clearContent(true)
    write()
    if (!chatId) useComposerDrafts.getState().renew()
  }, [editor, canSend, ready, onSubmit, attachments, target, chatId, key, write])
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
      editor?.commands.focus("end")
      // HTML drops a trailing space, and a prompt stem ("Find recent papers on ") needs it to type on
      if (/ $/.test(text)) editor?.commands.insertContent(" ")
      save()
    },
    openMention,
  }))

  return (
    <div
      className={cn(
        "@container relative flex w-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-md",
        dragging && "border-ring ring-2 ring-ring/30",
        className,
      )}
      {...dropProps}
    >
      {/* Only an agent that can't run gets a banner; a working one stays quiet */}
      {connector && blocked && (
        <button
          type="button"
          onClick={() => openSettings("agents")}
          className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70"
        >
          <span className="min-w-0 flex-1 truncate">
            {problemSentence(connector)}
            {connector.status === "error" && connector.error && ` · ${connector.error}`}
          </span>
          <span className="shrink-0 font-medium text-foreground">{t({ message: "Set up", comment: "verb: set up the agent in Settings" })}</span>
        </button>
      )}

      {header && <div className="flex flex-wrap gap-1 px-2.5 pt-2.5">{header}</div>}

      {files.length > 0 && (
        <div className="px-3 pt-3">
          <AttachmentList
            files={files}
            onRemove={attachments.remove}
            onOpen={openAttached}
            onAddToLibrary={(f) => attachments.addToLibrary(f.id)}
            reader={readerOf(connector)}
          />
        </div>
      )}
      <LargeFilesDialog files={attachments.large} onAnswer={attachments.answerLarge} />

      {/* Click anywhere in the editor area to focus */}
      <div className="cursor-text" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-1 px-2.5 pb-2.5">
        <DropdownMenu>
          <Tip label={t`Attach files or mention a paper, doc or note`}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="rounded-full text-muted-foreground" aria-label={t`Add attachments or context`}>
                <PlusIcon />
              </Button>
            </DropdownMenuTrigger>
          </Tip>
          {/* Keep focus in the editor after picking an item so the mention popup stays usable */}
          <DropdownMenuContent align="start" className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
              {t`Attach files`}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {(["paper", "doc", "thread"] as SourceKind[]).map((kind) => {
              const place = KIND_PLACE[kind]
              return (
                <DropdownMenuItem key={kind} onSelect={() => setTimeout(() => openMention(kind), 0)}>
                  {t`Add from ${place}`}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            attachments.add(Array.from(e.target.files ?? []))
            e.target.value = ""
          }}
        />

        <div className="ml-auto flex items-center gap-1">
          <AgentPicker chatId={chatId} />
          {streaming && !(waiting && typed) ? (
            <Tip label={t({ message: "Stop", comment: "verb: stop the agent's reply" })}>
              <Button size="icon-sm" className="rounded-full" onClick={onCancel} aria-label={t`Stop generating`}>
                <SquareIcon className="size-3 fill-current" />
              </Button>
            </Tip>
          ) : (
            <Tip label={t({ message: "Send", comment: "verb: send the message" })} shortcut="send">
              <Button size="icon-sm" className="rounded-full" disabled={!canSend} onClick={submit} aria-label={t`Send message`}>
                <ArrowUpIcon />
              </Button>
            </Tip>
          )}
        </div>
      </div>
    </div>
  )
})

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
