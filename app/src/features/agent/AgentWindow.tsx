import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { ArrowUpIcon, ChevronDownIcon, Maximize2Icon, PanelRightIcon, SquarePenIcon, XIcon } from "lucide-react"
import { cn } from "cn"
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
import { MessageGroup } from "@/components/ui/message"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Composer, type ComposerHandle } from "@/features/chat/components/composer/Composer"
import { AssistantMessage, UserMessage } from "@/features/chat/components/messages/MessageItem"
import { StatusRing } from "@/features/chat/components/StatusRing"
import { useChatStatus } from "@/features/chat/use-chat-status"
import { useBrokenReply, useLookAt } from "@/features/chat/status"
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
import { useAgentWindow } from "./store"

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

// At the right end of the top bar
export function AgentToggle() {
  const allowed = useAgentAllowed()
  const stage = useAgentWindow((s) => s.stage)
  const toggle = useAgentWindow((s) => s.toggle)
  if (!allowed) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Owlit" aria-pressed={stage !== "closed"} onClick={toggle} className={cn("ml-auto", stage !== "closed" && "bg-accent text-foreground")}>
          <PanelRightIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        Owlit <Kbd>⌘J</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

// A small bar at the bottom of the page for the first question; sending it opens the panel
export function AgentAskBar() {
  const allowed = useAgentAllowed()
  const stage = useAgentWindow((s) => s.stage)
  const selection = useAgentWindow((s) => s.selection)
  const focusTick = useAgentWindow((s) => s.focusTick)
  const context = useVisibleContext()
  const [text, setText] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (stage === "bar") input.current?.focus()
  }, [stage, focusTick])

  if (!allowed || stage !== "bar") return null

  const send = () => {
    if (!text.trim()) return
    useAgentWindow.getState().send({ text: text.trim(), mentions: [], attachments: [] }, context)
    setText("")
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex h-12 w-[min(600px,calc(100%-48px))] -translate-x-1/2 items-center gap-2 rounded-xl border bg-card pr-2 pl-2.5 shadow-md transition-[border-color] focus-within:border-foreground/20">
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
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault()
            send()
          }
          if (e.key === "Escape") useAgentWindow.getState().close()
        }}
        placeholder={context[0] ? `Ask about ${KIND_NAME[context[0].kind]}…` : "Ask Owlit…"}
        className="min-w-0 flex-1 bg-transparent pl-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
        aria-label="Ask Owlit"
      />
      <Button size="icon-sm" className="rounded-full" disabled={!text.trim()} onClick={send} aria-label="Send">
        <ArrowUpIcon />
      </Button>
    </div>
  )
}

// The conversation, docked as the third part of the sheet
export function AgentPanel() {
  const navigate = useNavigate()
  const chatId = useAgentWindow((s) => s.chatId)
  const selection = useAgentWindow((s) => s.selection)
  const focusTick = useAgentWindow((s) => s.focusTick)
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
    <aside className="flex w-[400px] shrink-0 flex-col border-l-[0.5px] bg-sidebar-panel" aria-label="Owlit" onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && close()}>
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
        <PanelButton label="New chat" onClick={newChat}>
          <SquarePenIcon />
        </PanelButton>
        <PanelButton
          label="Open in Chat"
          disabled={!chat}
          onClick={() => {
            if (!chat) return
            close()
            navigate(`/chat/${chat.id}`)
          }}
        >
          <Maximize2Icon />
        </PanelButton>
        <PanelButton label="Close" onClick={close}>
          <XIcon />
        </PanelButton>
      </header>

      {chat && chat.messages.length > 0 ? (
        <MessageScrollerProvider>
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport className="px-4" aria-label="Messages">
              <MessageScrollerContent className="w-full gap-6 py-2 pb-10">
                <MessageGroup className="gap-1">
                  {chat.messages.map((m, i) => (
                    <MessageScrollerItem key={m.id} messageId={m.id} scrollAnchor={m.role === "user"} className="pb-7">
                      {m.role === "user" ? (
                        <UserMessage message={m} />
                      ) : (
                        <AssistantMessage
                          message={m}
                          modelName={modelName(m.connectorId, m.modelId)}
                          onRespondPermission={(requestId, optionId) => useChatStore.getState().respondPermission(chat.id, requestId, optionId)}
                          onSaveAsDoc={(markdown) => saveAnswerAsDoc(chat.title, markdown, navigate)}
                          onRegenerate={!streaming ? () => regenerate(chat.id, i) : undefined}
                          onDismiss={broken?.messageId === m.id ? broken.dismiss : undefined}
                        />
                      )}
                    </MessageScrollerItem>
                  ))}
                </MessageGroup>
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton className="bottom-4 bg-popover shadow-md" />
          </MessageScroller>
        </MessageScrollerProvider>
      ) : (
        <div className="flex flex-1 items-end px-4 pb-3 text-[15px] text-muted-foreground">
          {context[0] ? `Ask about ${KIND_NAME[context[0].kind]}, or anything else.` : "Ask anything."}
        </div>
      )}

      <div className="relative shrink-0 px-3 pb-3">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-sidebar-panel to-transparent" />
        <Composer
          ref={composer}
          chatId={chat?.id}
          streaming={streaming}
          onCancel={() => chat && useChatStore.getState().cancel(chat.id)}
          onSubmit={(input) => send(input, context)}
          placeholder={chat?.messages.length ? "Ask a follow-up…" : "Ask Owlit…"}
          header={context.length || selection ? <ContextChips context={context} selection={selection} /> : undefined}
        />
      </div>
    </aside>
  )
}

// The chat list's status ring, so a chat at work reads the same in the switcher
function RecentStatus({ chatId }: { chatId: string }) {
  return <StatusRing status={useChatStatus(chatId)} />
}

function PanelButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} className="text-muted-foreground">
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
