import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { MessageSquareIcon, SquarePenIcon } from "lucide-react"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { useChatStore } from "../store"
import { useUiStore } from "../ui-store"

// ⌘K palette: jump to a chat by title or message text
export function ChatSearchDialog() {
  const open = useUiStore((s) => s.searchOpen)
  const setOpen = useUiStore((s) => s.setSearchOpen)
  const chats = useChatStore((s) => s.chats)
  const navigate = useNavigate()

  const items = useMemo(
    () =>
      Object.values(chats)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => ({
          id: c.id,
          title: c.title,
          // Searchable body: first user message
          preview: c.messages
            .filter((m) => m.role === "user")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join(" ")
            .slice(0, 200),
        })),
    [chats],
  )

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search chats" description="Find a conversation by title or content">
      <Command>
        <CommandInput placeholder="Search chats…" autoFocus />
        <CommandList>
        <CommandEmpty>No chats found.</CommandEmpty>
        <CommandGroup>
          <CommandItem onSelect={() => go("/chat")} value="new chat">
            <SquarePenIcon />
            New chat
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Chats">
          {items.map((c) => (
            <CommandItem key={c.id} value={`${c.title} ${c.preview}`} onSelect={() => go(`/chat/${c.id}`)}>
              <MessageSquareIcon />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{c.title}</span>
                {c.preview && <span className="truncate text-xs text-muted-foreground">{c.preview}</span>}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
