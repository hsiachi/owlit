import { useMemo, useState } from "react"
import { NavLink, useNavigate, useParams } from "react-router-dom"
import { EllipsisVerticalIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
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
import { useUiStore } from "../ui-store"
import type { Chat } from "../types"

// Rows are a touch taller than the shadcn default so the list breathes
const rowClass = "h-9 rounded-md px-2.5"

function ChatRow({ chat, active }: { chat: Chat; active: boolean }) {
  const navigate = useNavigate()
  const togglePin = useChatStore((s) => s.togglePin)
  const renameChat = useChatStore((s) => s.renameChat)
  const deleteChat = useChatStore((s) => s.deleteChat)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(chat.title)

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
    toast("Chat deleted", { description: chat.title })
  }

  return (
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
          className="h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Rename chat"
        />
      ) : (
        <SidebarMenuButton
          asChild
          isActive={active}
          className={cn(rowClass, "pr-9 group-hover/menu-item:bg-sidebar-accent group-has-[[data-state=open]]/menu-item:bg-sidebar-accent")}
        >
          <NavLink to={`/chat/${chat.id}`}>
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
              className="top-1/2! right-1.5 size-6 w-6 -translate-y-1/2 text-muted-foreground hover:bg-foreground/8 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground"
            >
              <EllipsisVerticalIcon />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-44">
            <DropdownMenuItem onSelect={() => togglePin(chat.id)}>{chat.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
            <DropdownMenuItem onSelect={startRename}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  )
}

// Second-column content for the Chat place: search, new chat, grouped history
export function ChatListPanel() {
  const { chatId } = useParams()
  const chats = useChatStore((s) => s.chats)
  const setSearchOpen = useUiStore((s) => s.setSearchOpen)

  const groups = useMemo(() => groupChats(Object.values(chats)), [chats])

  return (
    <>
      <SidebarHeader className="gap-1.5 px-2.5 pt-2.5 pb-1">
        {/* Looks like a search field, opens the ⌘K palette which also searches message text */}
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex h-9 w-full items-center gap-2.5 rounded-md border border-border/70 bg-background px-3 text-sm text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <Kbd className="bg-transparent">⌘K</Kbd>
        </button>
        <SidebarMenu className="pt-1.5">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={!chatId} className={rowClass}>
              <NavLink to="/chat" end>
                <span className="flex size-5 items-center justify-center rounded-full bg-foreground/8">
                  <PlusIcon className="size-3.5!" />
                </span>
                <span className="flex-1">New chat</span>
                <Kbd className="bg-transparent opacity-0 transition-opacity group-hover/menu-button:opacity-100">⌘N</Kbd>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {groups.length === 0 && <div className="px-4 py-3 text-sm text-muted-foreground">No chats yet.</div>}
        {groups.map((g) => (
          <SidebarGroup key={g.label} className="px-2.5 py-1">
            <SidebarGroupLabel className="h-7 px-2.5 text-[11px] font-normal text-muted-foreground">{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
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
