import { useMemo, useState } from "react"
import { NavLink, useNavigate, useParams } from "react-router-dom"
import { EllipsisVerticalIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { ActionsDropdownContent, ActionsOnRightClick, type MenuGroups } from "@/components/action-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { keysFor } from "@/app/shortcuts"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { groupChats } from "../lib/group-chats"
import { useChatStore } from "../store"
import { usePaletteStore } from "@/app/palette-store"
import { StatusRing } from "./StatusRing"
import { useChatStatus } from "../use-chat-status"
import type { Chat } from "../types"

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
const keepActionInIconMode = "group-data-[collapsible=icon]:flex"

function ChatRow({ chat, active }: { chat: Chat; active: boolean }) {
  const navigate = useNavigate()
  const togglePin = useChatStore((s) => s.togglePin)
  const renameChat = useChatStore((s) => s.renameChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(chat.title)
  const status = useChatStatus(chat.id)

  const commitRename = () => {
    renameChat(chat.id, draft)
    setRenaming(false)
  }

  const startRename = () => {
    setDraft(chat.title)
    // Wait for the menu to close and hand back focus before mounting the input
    setTimeout(() => setRenaming(true), 0)
  }

  const remove = () => {
    deleteChat(chat.id)
    if (active) navigate("/chat")
    toast("Chat deleted", {
      description: chat.title,
      action: { label: "Undo", onClick: () => void useChatStore.getState().restoreChat(chat.id).catch(() => undefined) },
    })
  }

  // The same actions from the row's ⋯ and from a right-click
  const groups: MenuGroups = [
    [
      { label: chat.pinned ? "Unpin" : "Pin", onSelect: () => togglePin(chat.id) },
      { label: "Rename", onSelect: startRename },
    ],
    [{ label: "Delete", destructive: true, onSelect: remove }],
  ]

  return (
    <ActionsOnRightClick groups={renaming ? [] : groups}>
      <SidebarMenuItem>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") {
                setDraft(chat.title)
                setRenaming(false)
              }
            }}
            className="h-9 w-full rounded-md border bg-card px-2.5 text-sm outline-none focus-key:border-foreground/30"
            aria-label="Rename chat"
          />
        ) : (
          <SidebarMenuButton
            asChild
            isActive={active}
            // The title gets the full row (cancelling the primitive's fixed pr-8 for the action); room for
            // the actions button is only made while it shows
            className={cn(
              rowClass,
              keepRowInIconMode,
              // Lit while its ⋯ menu or its right-click menu is open
              "group-hover/menu-item:bg-sidebar-accent group-has-[[data-state=open]]/menu-item:bg-sidebar-accent group-data-[state=open]/menu-item:bg-sidebar-accent",
              "group-has-data-[sidebar=menu-action]/menu-item:pr-2.5",
              "group-hover/menu-item:pr-8! group-focus-within/menu-item:pr-8! group-has-[[data-state=open]]/menu-item:pr-8!",
              "gap-2",
            )}
          >
            <NavLink to={`/chat/${chat.id}`}>
              <StatusRing status={status} />
              <span className="truncate">{chat.title}</span>
            </NavLink>
          </SidebarMenuButton>
        )}
        {!renaming && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* A small square that darkens on its own hover, on top of the row's hover */}
              <SidebarMenuAction
                showOnHover
                aria-label="Chat actions"
                className={cn(keepActionInIconMode, "top-1/2! right-1.5 size-6 w-6 -translate-y-1/2 text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground")}
              >
                <EllipsisVerticalIcon />
              </SidebarMenuAction>
            </DropdownMenuTrigger>
            <ActionsDropdownContent groups={groups} side="right" align="start" />
          </DropdownMenu>
        )}
      </SidebarMenuItem>
    </ActionsOnRightClick>
  )
}

// Second-column content for the Chat place: search, new chat, grouped history
export function ChatListPanel() {
  const { chatId } = useParams()
  const chats = useChatStore((s) => s.chats)
  const setSearchOpen = usePaletteStore((s) => s.setOpen)

  const groups = useMemo(() => groupChats(Object.values(chats)), [chats])

  return (
    <>
      <SidebarHeader className="gap-1.5 px-2.5 pt-2.5 pb-1">
        {/* Looks like a search field, opens the ⌘K palette, which also finds papers and message text */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-9 w-full items-center gap-2.5 rounded-md border border-border/70 bg-card px-3 text-sm text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-key:border-foreground/30 focus-key:text-foreground"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <Kbd className="bg-transparent">{keysFor("palette")}</Kbd>
        </button>
        <SidebarMenu className="pt-1.5">
          <SidebarMenuItem>
            {/* Never lit as the open page: New doc can't be, and a fill coming and going reads as the row jumping */}
            <SidebarMenuButton asChild className={cn(rowClass, keepRowInIconMode, "gap-2")}>
              <NavLink to="/chat" end>
                {/* The plus sits in the status slot every chat row has, so all titles start together */}
                <span className="grid size-5 place-items-center">
                  <span className="flex size-4.5 items-center justify-center rounded-full bg-foreground/8">
                    <PlusIcon className="size-3!" />
                  </span>
                </span>
                <span className="flex-1">New chat</span>
                <Kbd className="bg-transparent opacity-0 transition-opacity group-hover/menu-button:opacity-100">{keysFor("new")}</Kbd>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0 pb-4">
        {/* Placed exactly like Docs' "No docs yet.", so switching places doesn't move the gap under New */}
        {groups.length === 0 && <div className="mx-2.5 mt-3 px-2.5 py-2 text-sm text-muted-foreground">No chats yet.</div>}
        {groups.map((g) => (
          // Spacing ladder: label to its rows (tight) < row to row < group to group (wide)
          <SidebarGroup key={g.label} className="px-2.5 pt-5 pb-0 first:pt-2">
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
