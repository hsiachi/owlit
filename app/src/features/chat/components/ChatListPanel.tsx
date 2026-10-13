import { t } from "@lingui/core/macro"
import { useMemo, useState } from "react"
import { NavLink, useNavigate, useParams } from "react-router-dom"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { NewRow, PanelEmpty, PanelHeader } from "@/components/list-panel"
import { RenameInput } from "@/components/rename-input"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { groupChats } from "../lib/group-chats"
import { useChatStore } from "../store"
import { StatusRing } from "@/components/status-ring"
import { useChatStatus } from "../use-chat-status"
import { useChatList, type ChatListItem } from "../use-chat-list"
import { toastUndo } from "@/lib/toast"
import { FRESH_CHAT } from "./ChatEmpty"

// Rows are a touch taller than the shadcn default so the list breathes; the left edge is tighter, for the
// status slot every row starts with
const rowClass = "h-9 rounded-md pr-2.5 pl-1.5"

// The panel sits inside the icon-collapsible sidebar, so the shadcn primitives pick up its icon-mode styles
// when collapsed (rows shrink to 32px squares, labels slide up and fade). Those are meant for the rail only;
// cancel them here so the panel keeps its layout and is simply clipped while the sidebar collapses. The
// padding must match rowClass exactly: the primitive animates padding, so any difference plays as a
// small slide of every row each time the sidebar opens.
const keepRowInIconMode = "group-data-[collapsible=icon]:h-9! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:pr-2.5! group-data-[collapsible=icon]:pl-1.5!"
const keepLabelInIconMode = "group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:opacity-100"

function ChatRow({ chat, active }: { chat: ChatListItem; active: boolean }) {
  const navigate = useNavigate()
  const togglePin = useChatStore((s) => s.togglePin)
  const renameChat = useChatStore((s) => s.renameChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const [renaming, setRenaming] = useState(false)
  const status = useChatStatus(chat.id)

  const remove = () => {
    deleteChat(chat.id)
    if (active) navigate("/chat", { state: FRESH_CHAT })
    toastUndo(t`Chat deleted`, () => useChatStore.getState().restoreChat(chat.id).catch(() => undefined), { description: chat.title })
  }

  // The same actions from the row's ⋯ and from a right-click
  const groups: MenuGroups = [
    [
      { label: chat.pinned ? t({ message: "Unpin", comment: "verb: unpin a chat" }) : t({ message: "Pin", comment: "verb: pin a chat to the top" }), onSelect: () => togglePin(chat.id) },
      { label: t`Rename`, afterClose: true, onSelect: () => setRenaming(true) },
    ],
    [{ label: t`Delete`, destructive: true, onSelect: remove }],
  ]

  return (
    <ActionsOnRightClick groups={renaming ? [] : groups}>
      <SidebarMenuItem className="group/row">
        {renaming ? (
          <RenameInput
            initial={chat.title}
            label={t`Rename chat`}
            onDone={(name) => {
              if (name !== null) renameChat(chat.id, name)
              setRenaming(false)
            }}
            // The text stays where the title was: past the status slot, less the border
            className="h-9 pr-2.5 pl-[33px]"
          />
        ) : (
          <SidebarMenuButton
            asChild
            isActive={active}
            // The title gets the full row; room for the actions button is only made while it shows
            className={cn(
              rowClass,
              keepRowInIconMode,
              // Lit while its ⋯ menu or its right-click menu is open
              "group-hover/menu-item:bg-sidebar-accent group-has-[[data-state=open]]/menu-item:bg-sidebar-accent group-data-[state=open]/menu-item:bg-sidebar-accent",
              "group-hover/menu-item:pr-8! group-has-focus-key/menu-item:pr-8! group-has-data-menu-up/menu-item:pr-8!",
              "gap-2",
            )}
          >
            <NavLink to={`/chat/${chat.id}`}>
              <StatusRing status={status} />
              <span className="truncate">{chat.title}</span>
              {/* The two rungs that need the user also say so in a word at the row's end, in the text colour, so
                  neither rests on the dot's hue; the ring already reads it out */}
              {(status === "waiting" || status === "failed") && (
                <span aria-hidden className="ml-auto shrink-0 text-detail text-foreground">
                  {status === "waiting" ? t({ message: "Waiting", comment: "a chat's status: waiting on the user" }) : t({ message: "Stopped", comment: "a chat's status: the agent stopped with an error" })}
                </span>
              )}
            </NavLink>
          </SidebarMenuButton>
        )}
        {!renaming && <RowMenuButton groups={groups} label={t`Chat actions`} side="right" align="start" className="absolute top-1/2 right-1.5 -translate-y-1/2" />}
      </SidebarMenuItem>
    </ActionsOnRightClick>
  )
}

// Second-column content for the Chat place: search, new chat, grouped history
export function ChatListPanel() {
  const { chatId } = useParams()
  const chats = useChatList()
  const navigate = useNavigate()

  const groups = useMemo(() => groupChats(chats), [chats])

  return (
    <>
      <PanelHeader>
        <NewRow label={t`New chat`} onClick={() => navigate("/chat", { state: FRESH_CHAT })} />
      </PanelHeader>
      <SidebarContent className="gap-0 pb-4">
        {/* Placed exactly like Docs' "No docs yet.", so switching places doesn't move the gap under New */}
        {groups.length === 0 && <PanelEmpty className="mx-2.5 mt-3">{t`No chats yet.`}</PanelEmpty>}
        {groups.map((g) => (
          // Spacing ladder: label to its rows (tight) < row to row < group to group (wide)
          <SidebarGroup key={g.id} className="px-2.5 pt-5 pb-0 first:pt-2">
            <SidebarGroupLabel className={cn(keepLabelInIconMode, "h-6 items-end px-2.5 pb-1.5 text-xs font-normal text-muted-foreground")}>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              {/* 2px between rows, so the open chat's fill and a hovered neighbour stay apart */}
              <SidebarMenu className="gap-0.5">
                {g.chats.map((c) => (
                  <ChatRow key={c.id} chat={c} active={c.id === chatId} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </>
  )
}
