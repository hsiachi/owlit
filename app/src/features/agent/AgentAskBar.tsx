import { useEffect, useRef, useState } from "react"
import { ArrowUpIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFileDrop } from "@/hooks/use-file-drop"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { keysFor } from "@/app/shortcuts"
import { AttachmentList } from "@/features/chat/components/composer/AttachmentList"
import { LargeFilesDialog } from "@/features/chat/components/composer/LargeFilesDialog"
import { fromDrop, openAttached, readerOf, useAttachments } from "@/features/chat/lib/attachments"
import { useResolvedSelection } from "@/features/chat/use-selection"
import { useChatStore } from "@/features/chat/store"
import type { Mentionable } from "@/features/chat/types"
import { Chip, SelectionChip } from "./ContextChips"
import { useAgentAllowed } from "./hooks"
import { KIND_NAME, useVisibleContext } from "./page-context"
import { useAgentWindow } from "./store"

// A small bar at the bottom of the page for the first question; sending it opens the panel
export function AgentAskBar() {
  const allowed = useAgentAllowed()
  const stage = useAgentWindow((s) => s.stage)
  const selection = useAgentWindow((s) => s.selection)
  const focusTick = useAgentWindow((s) => s.focusTick)
  const hint = useAgentWindow((s) => s.hint)
  // The chat ⇧⌘J would bring back, named while the bar is empty so the way back is never a guess
  const chatId = useAgentWindow((s) => s.chatId)
  const current = useChatStore((s) => {
    const chat = chatId ? s.chats[chatId] : undefined
    return chat?.messages.length ? chat.title : null
  })
  const context = useVisibleContext()
  const [text, setText] = useState("")
  const input = useRef<HTMLInputElement>(null)
  // The bar takes files like the composer: copied into the folder of the chat it will start
  const [draftId, setDraftId] = useState(() => crypto.randomUUID())
  const [mentions, setMentions] = useState<Mentionable[]>([])
  const attachments = useAttachments(draftId, (m) => setMentions((list) => (list.some((x) => x.uri === m.uri) ? list : [...list, m])))
  const { connector } = useResolvedSelection(undefined)
  const { dragging, dropProps } = useFileDrop((data) => {
    const { files, folders } = fromDrop(data)
    attachments.add(files, folders)
  })

  useEffect(() => {
    if (stage === "bar") input.current?.focus()
  }, [stage, focusTick])

  if (!allowed || stage !== "bar") return null

  const ready = attachments.files.some((f) => f.state === "ready")
  const canSend = (!!text.trim() || ready || mentions.length > 0) && !attachments.adding
  const send = () => {
    if (!canSend) return
    useAgentWindow.getState().send({ text: text.trim(), mentions, attachments: attachments.take() }, context, draftId)
    setText("")
    setMentions([])
    setDraftId(crypto.randomUUID())
  }
  const holding = attachments.files.length > 0 || mentions.length > 0

  return (
    <div
      className={cn(
        "absolute bottom-4 left-1/2 z-20 flex w-[min(600px,calc(100%-48px))] -translate-x-1/2 flex-col rounded-xl border bg-card shadow-md transition-[border-color] focus-within:border-foreground/20",
        dragging && "border-ring ring-2 ring-ring/30",
      )}
      {...dropProps}
    >
      {holding && (
        <div className="flex min-w-0 items-center gap-1.5 px-2.5 pt-2">
          {mentions.map((m) => (
            <Chip key={m.uri} label={`Don't include ${m.title}`} onRemove={() => setMentions((list) => list.filter((x) => x.uri !== m.uri))}>
              <span className="text-mention">{m.title}</span>
            </Chip>
          ))}
          <AttachmentList
            files={attachments.files}
            size="xs"
            onRemove={attachments.remove}
            onOpen={openAttached}
            onAddToLibrary={(f) => attachments.addToLibrary(f.id)}
            reader={readerOf(connector)}
          />
        </div>
      )}
      <div className="flex h-12 items-center gap-2 pr-2 pl-2.5">
        {selection && (
          <span className="shrink-0">
            <SelectionChip selection={selection} length={24} />
          </span>
        )}
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files)
            if (!pasted.length) return
            e.preventDefault()
            attachments.add(pasted)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
            if (e.key === "Escape") useAgentWindow.getState().close()
          }}
          placeholder={hint ?? (context[0] ? `Ask about ${KIND_NAME[context[0].kind]}…` : "Ask Owlit…")}
          className="min-w-0 flex-1 bg-transparent pl-1.5 text-body outline-none placeholder:text-muted-foreground"
          aria-label="Ask Owlit"
        />
        {current && !text && !selection && !holding && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => useAgentWindow.getState().togglePanel()}
            className="flex h-7 min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Kbd>{keysFor("owlit-panel")}</Kbd>
            <span className="max-w-[200px] truncate">{current}</span>
          </button>
        )}
        <Button size="icon-sm" className="rounded-full" disabled={!canSend} onClick={send} aria-label="Send">
          <ArrowUpIcon />
        </Button>
      </div>
      <LargeFilesDialog files={attachments.large} onAnswer={attachments.answerLarge} />
    </div>
  )
}
