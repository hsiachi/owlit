import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDownIcon, Maximize2Icon, SquarePenIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/icon-button"
import { OwlitMark } from "@/components/owlit-mark"
import { PanelResizeHandle } from "@/components/panel-resize-handle"
import { StatusRing } from "@/components/status-ring"
import { GroupLabel } from "@/components/group-label"
import { ListRow } from "@/components/list-row"
import { ago } from "@/lib/time"
import { DEFAULT_ROLE, type Mentionable } from "@owlit/protocol"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ChatMessages } from "@/features/chat/components/ChatMessages"
import { ComposerDock } from "@/features/chat/components/ComposerDock"
import type { ComposerHandle } from "@/features/chat/components/composer/Composer"
import { useChatList } from "@/features/chat/use-chat-list"
import { useChatStatus } from "@/features/chat/use-chat-status"
import { useLookAt } from "@/features/chat/status"
import { roleName, roleOf } from "@/features/chat/lib/selection"
import { useChatStore } from "@/features/chat/store"
import { ContextChips } from "./ContextChips"
import { useAgentAllowed } from "./hooks"
import { askAboutOrAnything, useVisibleContext } from "./page-context"
import { CommandHint } from "@/features/chat/components/CommandHint"
import { useChatsAbout } from "./chats-about"
import { PAGE_MIN, PANEL_WIDTH, useAgentWindow } from "./store"

// At the right end of the top bar: the panel with the current chat, as ⇧⌘J. The feather is also the brand
// mark, so its tooltip says what it does, not just the name.
export function AgentToggle() {
  const allowed = useAgentAllowed()
  const docked = useAgentWindow((s) => s.stage === "open")
  const togglePanel = useAgentWindow((s) => s.togglePanel)
  if (!allowed) return null
  return (
    <IconButton data-tour="ask" label={t`Ask Owlit`} shortcut="owlit-panel" aria-pressed={docked} onClick={togglePanel} className={cn("ml-auto", docked && "bg-accent text-foreground")}>
      <OwlitMark />
    </IconButton>
  )
}

// The conversation, docked as the third part of the sheet
export function AgentPanel() {
  const chatId = useAgentWindow((s) => s.chatId)
  const selection = useAgentWindow((s) => s.selection)
  const focusTick = useAgentWindow((s) => s.focusTick)
  const prefill = useAgentWindow((s) => s.prefill)
  const panelWidth = useAgentWindow((s) => s.panelWidth)
  const { close, send } = useAgentWindow.getState()
  const context = useVisibleContext()
  const chat = useChatStore((s) => (chatId ? s.chats[chatId] : undefined))
  const streaming = useChatStore((s) => (chatId ? !!s.streaming[chatId] : false))
  const composer = useRef<ComposerHandle>(null)
  useLookAt(chat?.id)

  useEffect(() => {
    composer.current?.focus()
  }, [focusTick, chatId])

  // After the composer took its draft (its own effect runs first, as the child's), the question the page
  // handed over replaces it
  useEffect(() => {
    if (!prefill) return
    composer.current?.setAsk(prefill)
    useAgentWindow.setState({ prefill: null })
  }, [prefill])

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l-[0.5px] bg-sidebar-panel"
      // A narrower window narrows the panel before the page, down to the panel's least width
      style={{ width: `clamp(320px, ${panelWidth}px, max(320px, calc(100vw - ${PAGE_MIN}px)))` }}
      aria-label="Owlit" // i18n-ignore
      onKeyDown={(e) => e.key === "Escape" && !e.defaultPrevented && close()}
    >
      <ResizeEdge />
      <PanelHeader chatId={chat?.id} title={chat?.title} role={chat && chat.messages.length > 0 && roleOf(chat).id !== DEFAULT_ROLE ? roleName(roleOf(chat).id) : undefined} />
      {chat && chat.messages.length > 0 ? (
        <ChatMessages chat={chat} streaming={streaming} panel />
      ) : (
        <PanelEmpty page={context[0]} />
      )}
      <ComposerDock
        ref={composer}
        chat={chat}
        streaming={streaming}
        panel
        compact={panelWidth < 440}
        onSubmit={(input, id) => send(input, context, id)}
        placeholder={chat?.messages.length ? t`Ask a follow-up…` : t`Ask Owlit…`}
        header={context.length || selection ? <ContextChips context={context} selection={selection} /> : undefined}
      />
    </aside>
  )
}

// A chat with nothing in it yet: one block at the bottom by the composer, where the eye already is. From
// the top, what was said before and what can be asked now: the latest chats about the page beside it, so
// coming back to a paper (or finding the panel started afresh after a while away) puts them one click away;
// then the feather and what can be asked, and what "/" offers. The
// space above stays empty; split into a list in the middle and the rest at the bottom, it read as stray
// pieces. The feather is in ink: Owlit's green is for what Owlit has done, and here it hasn't done
// anything yet.
function PanelEmpty({ page }: { page?: Mentionable }) {
  const earlier = useChatsAbout(page?.uri)
  const showChat = useAgentWindow((s) => s.showChat)
  return (
    // mt-auto rather than justify-end, so a short panel scrolls to the top of the block instead of cutting it
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-3">
      <div className="mt-auto flex flex-col gap-5">
        {earlier.length > 0 && (
          <section className="-mx-2.5">
            <GroupLabel as="h3">{t({ message: "Earlier here", comment: "label over the chats about the page beside the Owlit panel" })}</GroupLabel>
            {earlier.map((id) => (
              <EarlierRow key={id} chatId={id} onOpen={() => showChat(id)} />
            ))}
          </section>
        )}
        <div className="flex flex-col items-start gap-3">
          <p className="flex items-center gap-2 text-body text-muted-foreground">
            <OwlitMark className="size-4 shrink-0" />
            {page ? askAboutOrAnything(page.kind) : t`Ask anything.`}
          </p>
          <CommandHint />
        </div>
      </div>
    </div>
  )
}

// Drawn as the header menu's chats are: the status ring, the title, and when it was last asked in
function EarlierRow({ chatId, onOpen }: { chatId: string; onOpen: () => void }) {
  const title = useChatStore((s) => s.chats[chatId]?.title)
  const updatedAt = useChatStore((s) => s.chats[chatId]?.updatedAt)
  const status = useChatStatus(chatId)
  if (title === undefined || updatedAt === undefined) return null
  return (
    <ListRow
      mark={<StatusRing status={status} />}
      title={title}
      end={ago(updatedAt)}
      onClick={onOpen}
      className="hover:bg-sidebar-accent focus-key:bg-sidebar-accent"
    />
  )
}

// The chat's title, opening the recent chats to switch to, with the chat's role after it when it isn't
// the usual one; New chat, Open in Chat and Close
function PanelHeader({ chatId, title, role }: { chatId?: string; title?: string; role?: string }) {
  const navigate = useNavigate()
  const { close, newChat, showChat } = useAgentWindow.getState()
  const chats = useChatList()
  const recent = useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8), [chats])
  return (
    <header className="flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="-ml-1.5 flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-sm font-medium outline-hidden hover:bg-accent focus-visible:bg-accent">
            <span className="truncate">{title ?? t`New chat`}</span>
            {role && <span className="shrink-0 font-normal text-muted-foreground">· {role}</span>}
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
          {recent.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">{t`No chats yet`}</div>}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      <IconButton label={t`New chat`} onClick={newChat}>
        <SquarePenIcon />
      </IconButton>
      <IconButton
        label={t`Open in Chat`}
        disabled={!chatId}
        onClick={() => {
          if (!chatId) return
          close()
          navigate(`/chat/${chatId}`)
        }}
      >
        <Maximize2Icon />
      </IconButton>
      <IconButton label={t({ message: "Close", comment: "verb: close the Owlit panel" })} onClick={close}>
        <XIcon />
      </IconButton>
    </header>
  )
}

// The store keeps the width within the panel's least and the page's least
function ResizeEdge() {
  const width = useAgentWindow((s) => s.panelWidth)
  const setWidth = useAgentWindow((s) => s.setPanelWidth)
  return <PanelResizeHandle label={t`Resize Owlit`} width={width} setWidth={setWidth} defaultWidth={PANEL_WIDTH} />
}

// The chat list's status ring, so a chat at work reads the same in the switcher
function RecentStatus({ chatId }: { chatId: string }) {
  return <StatusRing status={useChatStatus(chatId)} />
}
