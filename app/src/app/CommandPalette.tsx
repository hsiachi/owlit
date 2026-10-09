import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { BookOpenIcon, FilePlusIcon, FileTextIcon, MessageSquareIcon, SquarePenIcon } from "lucide-react"
import { cn } from "@/lib/utils"
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
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { isHidden } from "@/features/docs/lib/tree"
import { displayName, isMarkdown, parentPath } from "@/features/docs/types"
import { useNewDoc } from "@/features/docs/use-new-doc"
import { paperMeta } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { usePaletteStore } from "./palette-store"

// Before anything is typed, each group shows its most recent few
const RECENT = 6

// Every word typed must appear somewhere in what an item is known by. Fuzzy matching across a
// long value finds letters scattered over authors and venues, so it is not used. A match in the
// title (passed as the first keyword) ranks above one in the details.
function filter(value: string, search: string, keywords?: string[]): number {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 1
  const hay = value.toLowerCase()
  if (!words.every((w) => hay.includes(w))) return 0
  const title = keywords?.[0]?.toLowerCase() ?? ""
  return words.every((w) => title.includes(w)) ? 1 : 0.5
}

// ⌘K from anywhere: jump to a paper, a doc or a chat. The place you are in comes first.
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  const setOpen = usePaletteStore((s) => s.setOpen)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const chats = useChatStore((s) => s.chats)
  const papers = useLibraryStore((s) => s.papers)
  const files = useDocsStore((s) => s.files)
  const newDoc = useNewDoc()
  const [query, setQuery] = useState("")

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!usePaletteStore.getState().open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  const paperItems = useMemo(
    () =>
      Object.values(papers)
        // Recently opened first, then recently added
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt)
        .map((p) => ({
          id: p.id,
          title: p.title,
          meta: paperMeta(p),
          // Everything one might remember a paper by
          value: [p.title, p.authors.join(" "), p.year, p.venue, p.tags.join(" "), p.ids.doi, p.ids.arxiv, p.abstract, p.id].filter(Boolean).join(" "),
        })),
    [papers],
  )

  const chatItems = useMemo(
    () =>
      Object.values(chats)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => {
          // Searchable body: what the user wrote
          const preview = c.messages
            .filter((m) => m.role === "user")
            .flatMap((m) => m.parts)
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join(" ")
            .slice(0, 200)
          return { id: c.id, title: c.title, preview, value: `${c.title} ${preview} ${c.id}` }
        }),
    [chats],
  )

  const docItems = useMemo(
    () =>
      Object.values(files)
        .filter((f) => isMarkdown(f.path) && !isHidden(f.path))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .map((f) => {
          const title = displayName(f.path)
          // Found by its name, its folder, or anything written in it
          return { id: f.id, title, folder: parentPath(f.path), value: `${title} ${f.path} ${f.content ?? ""}` }
        }),
    [files],
  )

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const typing = query.trim() !== ""
  const inChat = pathname.startsWith("/chat")
  const inDocs = pathname.startsWith("/docs")

  const paperGroup = (
    <CommandGroup key="papers" heading="Papers" className="p-0">
      {(typing ? paperItems : paperItems.slice(0, RECENT)).map((p) => (
        <CommandItem key={p.id} value={p.value} keywords={[p.title]} onSelect={() => go(`/library/${p.id}`)} className={itemClass}>
          <BookOpenIcon />
          <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <span className="max-w-[70%] shrink-0 truncate">{p.title}</span>
            <span className="min-w-0 truncate text-sm text-muted-foreground">{p.meta}</span>
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )

  const chatGroup = (
    <CommandGroup key="chats" heading="Chats" className="p-0">
      {(typing ? chatItems : chatItems.slice(0, RECENT)).map((c) => (
        <CommandItem key={c.id} value={c.value} keywords={[c.title]} onSelect={() => go(`/chat/${c.id}`)} className={itemClass}>
          <MessageSquareIcon />
          {/* The title keeps its width; the preview takes what's left */}
          <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <span className="max-w-[70%] shrink-0 truncate">{c.title}</span>
            {c.preview && <span className="min-w-0 truncate text-sm text-muted-foreground">{c.preview}</span>}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )

  const docGroup = (
    <CommandGroup key="docs" heading="Docs" className="p-0">
      {(typing ? docItems : docItems.slice(0, RECENT)).map((d) => (
        <CommandItem key={d.id} value={d.value} keywords={[d.title]} onSelect={() => go(`/docs/${d.id}`)} className={itemClass}>
          <FileTextIcon />
          <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <span className="max-w-[70%] shrink-0 truncate">{d.title}</span>
            {d.folder && <span className="min-w-0 truncate text-sm text-muted-foreground">{d.folder}</span>}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )

  // ⌘N makes whatever belongs to the place you are in
  const newChat = (
    <CommandItem key="new-chat" onSelect={() => go("/chat")} value="new chat" className={itemClass}>
      <SquarePenIcon />
      New chat
      {inChat && <CommandShortcut>⌘N</CommandShortcut>}
    </CommandItem>
  )
  const newDocItem = (
    <CommandItem
      key="new-doc"
      onSelect={() => {
        setOpen(false)
        newDoc()
      }}
      value="new doc"
      className={itemClass}
    >
      <FilePlusIcon />
      New doc
      {inDocs && <CommandShortcut>⌘N</CommandShortcut>}
    </CommandItem>
  )
  const actions = (
    <CommandGroup key="actions" heading="Actions" className="p-0">
      {inDocs ? [newDocItem, newChat] : [newChat, newDocItem]}
    </CommandGroup>
  )

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery("")
      }}
      title="Search"
      description="Jump to a paper, a doc or a chat"
      className="top-[18%] sm:max-w-2xl"
    >
      {/* Overrides open up the stock palette: a plain, large input and roomy rows */}
      <Command
        filter={filter}
        className={cn(
          "p-0",
          "**:data-[slot=command-input-wrapper]:border-b **:data-[slot=command-input-wrapper]:px-3 **:data-[slot=command-input-wrapper]:py-2",
          "**:data-[slot=input-group]:h-11! **:data-[slot=input-group]:border-transparent **:data-[slot=input-group]:bg-transparent **:data-[slot=input-group]:px-1",
          "**:data-[slot=command-input]:text-base",
          "**:[[cmdk-group-heading]]:px-3! **:[[cmdk-group-heading]]:pt-2.5! **:[[cmdk-group-heading]]:pb-1.5! **:[[cmdk-group-heading]]:font-normal!",
        )}
      >
        <CommandInput placeholder="Search papers, docs and chats…" value={query} onValueChange={setQuery} autoFocus />
        <CommandList className="max-h-[26rem] p-2">
          <CommandEmpty className="py-10 text-muted-foreground">Nothing found.</CommandEmpty>
          {inChat
            ? [actions, chatGroup, paperGroup, docGroup]
            : inDocs
              ? [actions, docGroup, paperGroup, chatGroup]
              : [paperGroup, docGroup, chatGroup, actions]}
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
