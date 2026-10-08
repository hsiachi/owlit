import { useMemo, useState } from "react"
import { NavLink, useNavigate, useParams } from "react-router-dom"
import { MoreHorizontalIcon, PencilIcon, PinIcon, PinOffIcon, SearchIcon, SquarePenIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { groupChats } from "../lib/group-chats"
import { useChatStore } from "../store"
import { useUiStore } from "../ui-store"
import type { Chat } from "../types"

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
          className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label="Rename chat"
        />
      ) : (
        <SidebarMenuButton asChild isActive={active} className="pr-7">
          <NavLink to={`/chat/${chat.id}`}>
            <span className="truncate">{chat.title}</span>
          </NavLink>
        </SidebarMenuButton>
      )}
      {!renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction showOnHover aria-label="Chat actions">
              <MoreHorizontalIcon />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-44">
            <DropdownMenuItem onSelect={() => togglePin(chat.id)}>
              {chat.pinned ? <PinOffIcon /> : <PinIcon />}
              {chat.pinned ? "Unpin" : "Pin"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setDraft(chat.title)
                setTimeout(() => setRenaming(true), 0)
              }}
            >
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2Icon />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </SidebarMenuItem>
  )
}

// Second-column content for the Chat place: new chat, search, grouped history
export function ChatListPanel() {
  const navigate = useNavigate()
  const { chatId } = useParams()
  const chats = useChatStore((s) => s.chats)
  const setSearchOpen = useUiStore((s) => s.setSearchOpen)
  const [query, setQuery] = useState("")

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = Object.values(chats).filter((c) => !q || c.title.toLowerCase().includes(q))
    return groupChats(list)
  }, [chats, query])

  return (
    <>
      <SidebarHeader className="gap-3.5 border-b p-4">
        <div className="flex w-full items-center justify-between">
          <div className="text-base font-medium text-foreground">Chat</div>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setSearchOpen(true)} aria-label="Search chats">
                  <SearchIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                Search <Kbd>⌘K</Kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => navigate("/chat")} aria-label="New chat">
                  <SquarePenIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex items-center gap-1.5">
                New chat <Kbd>⌘N</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <InputGroup className="bg-background">
          <InputGroupInput placeholder="Filter chats…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </InputGroup>
      </SidebarHeader>
      <SidebarContent>
        {groups.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">{query ? "No chats match." : "No chats yet. Start one on the right."}</div>
        )}
        {groups.map((g) => (
          <SidebarGroup key={g.label}>
            <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
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
