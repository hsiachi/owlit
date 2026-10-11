import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { ArrowUpIcon, ChevronDownIcon, Maximize2Icon, SquarePenIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/icon-button"
import { OwlitMark } from "@/components/owlit-mark"
import { PanelResizeHandle } from "@/components/panel-resize-handle"
import { useFileDrop } from "@/hooks/use-file-drop"
import { StatusRing } from "@/components/status-ring"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { keysFor } from "@/app/shortcuts"
import { agentName, Composer, openAttached, type ComposerHandle } from "@/features/chat/components/composer/Composer"
import { AttachmentList } from "@/features/chat/components/composer/AttachmentList"
import { useResolvedSelection } from "@/features/chat/components/composer/AgentPicker"
import { fromDrop, useAttachments } from "@/features/chat/lib/attachments"
import { AssistantMessage, UserMessage } from "@/features/chat/components/messages/MessageItem"
import { useChatStatus } from "@/features/chat/use-chat-status"
import { pendingAsk, useBrokenReply, useLookAt } from "@/features/chat/status"
import { WaitingDock } from "@/features/chat/components/WaitingDock"
import { regenerate } from "@/features/chat/lib/regenerate"
import { useChatStore } from "@/features/chat/store"
import type { Mentionable, QuotedSelection } from "@/features/chat/types"
import { docMentionable, paperMentionable } from "@/features/docs/lib/mentions"
import { saveAnswerAsDoc } from "@/features/docs/save-as-doc"
import { useDocsStore } from "@/features/docs/store"
import { topicUri } from "@/features/knowledge/format"
import { useTopics } from "@/features/knowledge/store"
import { useLibraryStore } from "@/features/library/store"
import { useAgentAllowed } from "./hooks"
import { PAGE_MIN, PANEL_WIDTH, useAgentWindow } from "./store"

// A passage's chip names where it came from: a Knowledge line, a page of a paper, the paper's note
const selectionLabel = (s: QuotedSelection) => (s.source.kind === "knowledge" ? "Line" : s.notePath ? "Note" : s.page ? `p. ${s.page}` : "Selection")

// The doc or paper on screen, which the agent is shown along with the question
function usePageContext(): Mentionable | null {
  const { pathname } = useLocation()
  const docId = /^\/docs\/([^/]+)$/.exec(pathname)?.[1]
  const paperId = /^\/library\/([^/]+)$/.exec(pathname)?.[1]
  const topicId = /^\/knowledge\/([^/]+)$/.exec(pathname)?.[1]
  const doc = useDocsStore((s) => (docId ? s.files[docId] : undefined))
  const paper = useLibraryStore((s) => (paperId ? s.papers[paperId] : undefined))
  const topics = useTopics()
  const topic = topicId ? topics.find((t) => t.id === decodeURIComponent(topicId)) : undefined
  const docPath = doc?.path
  return useMemo(() => {
    if (doc && docPath) return docMentionable(doc)
    if (paper) return paperMentionable(paper)
    if (topic) return { id: topic.id, kind: "knowledge", title: topic.name, subtitle: "Topic", uri: topicUri(topic.id) } satisfies Mentionable
    return null
    // The chip only needs to change when the doc's name, the paper or the topic's name does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, docPath, paper, topic?.id, topic?.name])
}

function useVisibleContext() {
  const page = usePageContext()
  const hidden = useAgentWindow((s) => s.hiddenContext)
  return page && page.uri !== hidden ? [page] : []
}

const KIND_NAME = { paper: "this paper", doc: "this doc", knowledge: "this topic" } as const

// Cut at a word boundary, so a chip never ends mid-word ("Scholars need to k…")
const shorten = (text: string, n: number) => {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= n) return t
  const cut = t.slice(0, n + 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > n / 2 ? cut.slice(0, space) : t.slice(0, n)).replace(/[\s,.;:]+$/, "")}…`
}

function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex h-6 max-w-full min-w-0 items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}

function ContextChips({ context, selection }: { context: Mentionable[]; selection: QuotedSelection | null }) {
  const { hideContext, clearSelection } = useAgentWindow.getState()
  return (
    <>
      {context.map((c) => (
        <Chip key={c.uri} label={`Don't include ${c.title}`} onRemove={() => hideContext(c.uri)}>
          <span className="text-mention">{c.title}</span>
        </Chip>
      ))}
      {selection && (
        <Chip label="Don't include the selection" onRemove={clearSelection}>
          {selectionLabel(selection)} · “{shorten(selection.text, 40)}”
        </Chip>
      )}
    </>
  )
}

// At the right end of the top bar: the panel with the current chat, as ⇧⌘J
export function AgentToggle() {
  const allowed = useAgentAllowed()
  const docked = useAgentWindow((s) => s.stage === "open")
  const togglePanel = useAgentWindow((s) => s.togglePanel)
  if (!allowed) return null
  return (
    <IconButton label="Owlit" shortcut="owlit-panel" aria-pressed={docked} onClick={togglePanel} className={cn("ml-auto", docked && "bg-accent text-foreground")}>
      <OwlitMark />
    </IconButton>
  )
}

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
            reader={connector?.cannotRead?.length ? { name: agentName(connector.name), cannotRead: connector.cannotRead } : undefined}
          />
        </div>
      )}
      <div className="flex h-12 items-center gap-2 pr-2 pl-2.5">
        {selection && (
          <span className="shrink-0">
            <Chip label="Don't include the selection" onRemove={() => useAgentWindow.getState().clearSelection()}>
              {selectionLabel(selection)} · “{shorten(selection.text, 24)}”
            </Chip>
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
      {attachments.dialog}
    </div>
  )
}

// The conversation, docked as the third part of the sheet
export function AgentPanel() {
  const navigate = useNavigate()
  const chatId = useAgentWindow((s) => s.chatId)
  const selection = useAgentWindow((s) => s.selection)
  const focusTick = useAgentWindow((s) => s.focusTick)
  const panelWidth = useAgentWindow((s) => s.panelWidth)
  const { close, newChat, showChat, send } = useAgentWindow.getState()
  const context = useVisibleContext()
  const chat = useChatStore((s) => (chatId ? s.chats[chatId] : undefined))
  const streaming = useChatStore((s) => (chatId ? !!s.streaming[chatId] : false))
  const connectors = useChatStore((s) => s.connectors)
  const chats = useChatStore((s) => s.chats)
  const recent = useMemo(() => Object.values(chats).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [chats])
  const composer = useRef<ComposerHandle>(null)
  useLookAt(chat?.id)
  const broken = useBrokenReply(chat)

  useEffect(() => {
    composer.current?.focus()
  }, [focusTick, chatId])

  const modelName = (connectorId?: string, modelId?: string) => connectors.find((c) => c.id === connectorId)?.models.find((m) => m.id === modelId)?.name

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l-[0.5px] bg-sidebar-panel"
      // A narrower window narrows the panel before the page, down to the panel's least width
      style={{ width: `clamp(320px, ${panelWidth}px, max(320px, calc(100vw - ${PAGE_MIN}px)))` }}
      aria-label="Owlit"
      onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && close()}
    >
      <ResizeEdge />
      <header className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="-ml-1.5 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-sm font-medium outline-hidden hover:bg-accent focus-visible:bg-accent">
              <span className="truncate">{chat?.title ?? "New chat"}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {recent.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => showChat(c.id)} className="gap-1.5 pl-1">
                <RecentStatus chatId={c.id} />
                <span className="truncate">{c.title}</span>
              </DropdownMenuItem>
            ))}
            {recent.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No chats yet</div>}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <IconButton label="New chat" onClick={newChat}>
          <SquarePenIcon />
        </IconButton>
        <IconButton
          label="Open in Chat"
          disabled={!chat}
          onClick={() => {
            if (!chat) return
            close()
            navigate(`/chat/${chat.id}`)
          }}
        >
          <Maximize2Icon />
        </IconButton>
        <IconButton label="Close" onClick={close}>
          <XIcon />
        </IconButton>
      </header>

      {/* One scroller per chat, so switching chats opens the next one at its end */}
      {chat && chat.messages.length > 0 ? (
        <MessageScrollerProvider key={chat.id}>
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport className="px-4" aria-label="Messages">
              <MessageScrollerContent className="w-full gap-1 py-2 pb-10">
                {/* Spacing and the always-rendered latest exchange as in ChatView */}
                {chat.messages.map((m, i) => (
                  <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"} className={cn("pb-7", i >= chat.messages.length - 2 && "[content-visibility:visible]")}>
                    {m.role === "user" ? (
                      <UserMessage message={m} />
                    ) : (
                      <AssistantMessage
                        message={m}
                        modelName={modelName(m.connectorId, m.modelId)}
                        onSaveAsDoc={(markdown) => saveAnswerAsDoc(chat.title, markdown, navigate)}
                        onRegenerate={!streaming ? () => regenerate(chat.id, i) : undefined}
                        onDismiss={broken?.messageId === m.id ? broken.dismiss : undefined}
                      />
                    )}
                  </MessageScrollerItem>
                ))}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton className="bottom-4 bg-popover shadow-md" />
          </MessageScroller>
        </MessageScrollerProvider>
      ) : (
        <div className="flex flex-1 items-end px-4 pb-3 text-body text-muted-foreground">
          {context[0] ? `Ask about ${KIND_NAME[context[0].kind]}, or anything else.` : "Ask anything."}
        </div>
      )}

      <div className="relative shrink-0 px-3 pb-3">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-sidebar-panel to-transparent" />
        {chat && <WaitingDock chat={chat} compact={panelWidth < 440} />}
        <Composer
          ref={composer}
          chatId={chat?.id}
          streaming={streaming}
          waiting={chat && streaming ? pendingAsk(chat)?.type : undefined}
          onCancel={() => chat && useChatStore.getState().cancel(chat.id)}
          onSubmit={(input, id) => send(input, context, id)}
          placeholder={chat?.messages.length ? "Ask a follow-up…" : "Ask Owlit…"}
          header={context.length || selection ? <ContextChips context={context} selection={selection} /> : undefined}
        />
      </div>
    </aside>
  )
}

// The store keeps the width within the panel's least and the page's least
function ResizeEdge() {
  const width = useAgentWindow((s) => s.panelWidth)
  const setWidth = useAgentWindow((s) => s.setPanelWidth)
  return <PanelResizeHandle label="Resize Owlit" width={width} setWidth={setWidth} defaultWidth={PANEL_WIDTH} />
}

// The chat list's status ring, so a chat at work reads the same in the switcher
function RecentStatus({ chatId }: { chatId: string }) {
  return <StatusRing status={useChatStatus(chatId)} />
}
