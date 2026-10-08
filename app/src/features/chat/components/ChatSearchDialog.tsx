import { useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { MessageSquareIcon, SquarePenIcon } from "lucide-react"
import { cn } from "cn"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
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
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search chats"
      description="Find a conversation by title or content"
      className="top-[18%] sm:max-w-2xl"
    >
      {/* Overrides open up the stock palette: a plain, large input and roomy rows */}
      <Command
        className={cn(
          "p-0",
          "**:data-[slot=command-input-wrapper]:border-b **:data-[slot=command-input-wrapper]:px-3 **:data-[slot=command-input-wrapper]:py-2",
          "**:data-[slot=input-group]:h-11! **:data-[slot=input-group]:border-transparent **:data-[slot=input-group]:bg-transparent **:data-[slot=input-group]:px-1",
          "**:data-[slot=command-input]:text-base",
          "**:[[cmdk-group-heading]]:px-3! **:[[cmdk-group-heading]]:pt-2.5! **:[[cmdk-group-heading]]:pb-1.5! **:[[cmdk-group-heading]]:font-normal!",
        )}
      >
        <CommandInput placeholder="Search chats…" autoFocus />
        <CommandList className="max-h-[26rem] p-2">
          <CommandEmpty className="py-10 text-muted-foreground">No chats found.</CommandEmpty>
          <CommandGroup heading="Actions" className="p-0">
            <CommandItem onSelect={() => go("/chat")} value="new chat" className={itemClass}>
              <SquarePenIcon />
              New chat
              <CommandShortcut>⌘N</CommandShortcut>
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Chats" className="p-0">
            {items.map((c) => (
              <CommandItem key={c.id} value={`${c.title} ${c.preview}`} onSelect={() => go(`/chat/${c.id}`)} className={itemClass}>
                <MessageSquareIcon />
                {/* The title keeps its width; the preview takes what's left */}
                <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                  <span className="max-w-[70%] shrink-0 truncate">{c.title}</span>
                  {c.preview && <span className="min-w-0 truncate text-sm text-muted-foreground">{c.preview}</span>}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        <div className="flex items-center gap-5 border-t px-4 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Open <Kbd>↵</Kbd>
          </span>
          <span className="flex items-center gap-1.5">
            Navigate <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            Close <Kbd>Esc</Kbd>
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}

const itemClass = "gap-3 rounded-md px-3 py-2 text-[15px] [&_svg]:text-muted-foreground"
