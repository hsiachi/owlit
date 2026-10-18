import { t } from "@lingui/core/macro"
import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { FilePlusIcon, SquarePenIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { KindIcon } from "@/components/kind-icon"
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
import { keysFor, useShortcut } from "@/app/shortcuts"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { isHidden } from "@/features/docs/lib/tree"
import { displayName, isMarkdown, parentPath } from "@/features/docs/types"
import { useNewDoc } from "@/features/docs/use-new-doc"
import { paperMeta } from "@/features/library/lib/format"
import { useLibraryStore } from "@/features/library/store"
import { useFullText } from "@/features/search/full-text"
import { messageText } from "@/features/chat/lib/message-text"
import type { Kind } from "@/lib/kinds"
import { hasAllWords, queryWords } from "@/lib/words"
import { closePalette, openPalette, usePaletteStore } from "./palette-store"

// Before anything is typed, each group shows its most recent few; after, its best matches. cmdk mounts
// and sorts every row it is given, which at a thousand papers costs about a second per key, so the
// palette filters itself and hands cmdk only what it shows.
const RECENT = 6
const MATCHES = 20

// Every word typed must appear somewhere in what an item is known by. Fuzzy matching across a
// long value finds letters scattered over authors and venues, so it is not used. A match in the
// title ranks above one in the details.
function score(value: string, title: string, search: string): number {
  const words = queryWords(search)
  if (words.length === 0) return 1
  if (!hasAllWords(value, words)) return 0
  return hasAllWords(title, words) ? 1 : 0.5
}

// ⌘K from anywhere: jump to a paper, a doc or a chat. The place you are in comes first.
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  useShortcut("palette", () => (usePaletteStore.getState().open ? closePalette() : openPalette()))
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => !o && closePalette()}
      title={t`Search`}
      description={t`Jump to a paper, a doc or a chat`}
      className="top-[18%] sm:max-w-2xl"
    >
      {/* Mounted only while the palette shows, so a streamed reply or a doc write doesn't rebuild its lists */}
      <PaletteBody />
    </CommandDialog>
  )
}

interface Item {
  id: string
  // cmdk's key; it changes when what the row shows does
  key: string
  title: string
  // Muted text after the title
  detail?: string
  // Everything the filter matches against
  value: string
}

function PaletteBody() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const chats = useChatStore((s) => s.chats)
  const papers = useLibraryStore((s) => s.papers)
  const files = useDocsStore((s) => s.files)
  const newDoc = useNewDoc()
  const [query, setQuery] = useState("")
  // Papers whose text (not just their details) has every word typed
  const fullText = useFullText(query)

  const paperItems = useMemo(
    () =>
      Object.values(papers)
        // Recently opened first, then recently added
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt)
        .map((p) => {
          // Everything one might remember a paper by
          const details = [p.title, p.authors.join(" "), p.year, p.venue, p.tags.join(" "), p.ids.doi, p.ids.arxiv, p.abstract, p.id].filter(Boolean).join(" ")
          // A paper found by its text carries the words around the match, which the filter reads and the
          // row shows in place of its details. A new key once a text match arrives: cmdk works out its
          // groups when an item comes, not when an item's value changes.
          const snippet = fullText.papers[p.id]
          return {
            id: p.id,
            key: snippet ? `${p.id}:text` : p.id,
            title: p.title,
            detail: paperMeta(p),
            details,
            snippet,
            value: snippet ? `${details} ${snippet}` : details,
          }
        }),
    [papers, fullText],
  )

  const chatItems = useMemo(
    () =>
      Object.values(chats)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c): Item => {
          // Searchable body: what the user wrote
          const preview = c.messages
            .filter((m) => m.role === "user")
            .map((m) => messageText(m, " "))
            .filter(Boolean)
            .join(" ")
            .slice(0, 200)
          return { id: c.id, key: c.id, title: c.title, detail: preview, value: `${c.title} ${preview} ${c.id}` }
        }),
    [chats],
  )

  const docItems = useMemo(
    () =>
      Object.values(files)
        .filter((f) => isMarkdown(f.path) && !isHidden(f.path))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .map((f): Item => {
          const title = displayName(f.path)
          // Found by its name, its folder, or anything written in it
          return { id: f.id, key: f.id, title, detail: parentPath(f.path), value: `${title} ${f.path} ${f.content ?? ""}` }
        }),
    [files],
  )

  const go = (to: string) => {
    closePalette()
    navigate(to)
  }

  const typing = query.trim() !== ""
  // Title matches first, each kept in its group's order (most recent first)
  const shown = <T extends Item>(items: T[]) => {
    if (!typing) return items.slice(0, RECENT)
    const scored = items.map((item) => ({ item, score: score(item.value, item.title, query) })).filter((s) => s.score > 0)
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, MATCHES)
      .map((s) => s.item)
  }
  const inChat = pathname.startsWith("/chat")
  const inDocs = pathname.startsWith("/docs")
  // The words around a text match, unless what was typed is already in the paper's details
  const paperRows = shown(paperItems).map((p) => (p.snippet && !inDetails(p.details, query) ? { ...p, detail: p.snippet } : p))

  const paperGroup = <PaletteGroup key="papers" heading={t`Papers`} kind="paper" to="/library" items={paperRows} go={go} />
  const chatGroup = <PaletteGroup key="chats" heading={t`Chats`} kind="chat" to="/chat" items={shown(chatItems)} go={go} />
  const docGroup = <PaletteGroup key="docs" heading={t`Docs`} kind="doc" to="/docs" items={shown(docItems)} go={go} />

  // ⌘N makes whatever belongs to the place you are in. Found by its English name too, as well as by the
  // name it shows.
  const newChatLabel = t`New chat`
  const newDocLabel = t`New doc`
  const newChat = (
    <CommandItem key="new-chat" onSelect={() => go("/chat")} value={`new chat ${newChatLabel}`} className={itemClass}>
      <SquarePenIcon />
      {newChatLabel}
      {inChat && <CommandShortcut>{keysFor("new")}</CommandShortcut>}
    </CommandItem>
  )
  const newDocItem = (
    <CommandItem
      key="new-doc"
      onSelect={() => {
        closePalette()
        newDoc()
      }}
      value={`new doc ${newDocLabel}`}
      className={itemClass}
    >
      <FilePlusIcon />
      {newDocLabel}
      {inDocs && <CommandShortcut>{keysFor("new")}</CommandShortcut>}
    </CommandItem>
  )
  const actionItems = (inDocs ? [newDocItem, newChat] : [newChat, newDocItem]).filter((item) => score(item.props.value, "", query) > 0)
  const actions = actionItems.length > 0 && (
    <CommandGroup key="actions" heading={t`Actions`} className="p-0">
      {actionItems}
    </CommandGroup>
  )

  return (
    // Overrides open up the stock palette: a plain, large input and roomy rows
    <Command
      shouldFilter={false}
      className={cn(
        "p-0",
        "**:data-[slot=command-input-wrapper]:border-b **:data-[slot=command-input-wrapper]:px-3 **:data-[slot=command-input-wrapper]:py-2",
        "**:data-[slot=input-group]:h-11! **:data-[slot=input-group]:border-transparent **:data-[slot=input-group]:bg-transparent **:data-[slot=input-group]:px-1",
        "**:data-[slot=command-input]:text-base",
        "**:[[cmdk-group-heading]]:px-3! **:[[cmdk-group-heading]]:pt-2.5! **:[[cmdk-group-heading]]:pb-1.5! **:[[cmdk-group-heading]]:font-normal!",
      )}
    >
      <CommandInput placeholder={t`Search papers, docs and chats…`} value={query} onValueChange={setQuery} autoFocus />
      <CommandList className="max-h-[26rem] p-2">
        <CommandEmpty className="py-10 text-muted-foreground">{fullText.indexing ? t`Nothing found yet. Still indexing…` : t`Nothing found.`}</CommandEmpty>
        {inChat
          ? [actions, chatGroup, paperGroup, docGroup]
          : inDocs
            ? [actions, docGroup, paperGroup, chatGroup]
            : [paperGroup, docGroup, chatGroup, actions]}
      </CommandList>
      <div className="flex items-center gap-5 border-t px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {t({ message: "Open", comment: "palette footer, beside the Enter key: opens the selected row" })} <Kbd>↵</Kbd>
        </span>
        <span className="flex items-center gap-1.5">
          {t({ message: "Navigate", comment: "palette footer, beside the arrow keys: moves between rows" })} <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {t({ message: "Close", comment: "palette footer, beside the Esc key: closes the palette" })} <Kbd>Esc</Kbd>
        </span>
      </div>
    </Command>
  )
}

// Papers, chats or docs: the kind's icon, the title keeping its width, the detail taking what's left
function PaletteGroup({ heading, kind, to, items, go }: { heading: string; kind: Kind; to: string; items: Item[]; go: (to: string) => void }) {
  return (
    <CommandGroup heading={heading} className="p-0">
      {items.map((item) => (
        <CommandItem key={item.key} value={item.value} onSelect={() => go(`${to}/${item.id}`)} className={itemClass}>
          <KindIcon kind={kind} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
            <span className="max-w-[70%] shrink-0 truncate">{item.title}</span>
            {item.detail && <span className="min-w-0 truncate text-sm text-muted-foreground">{item.detail}</span>}
          </span>
        </CommandItem>
      ))}
    </CommandGroup>
  )
}

const itemClass = "gap-3 rounded-md px-3 py-2 text-body [&_svg]:text-muted-foreground"

// Whether every word typed is in what the row shows besides the text (title, authors, venue, …)
const inDetails = (value: string, query: string) => hasAllWords(value, queryWords(query))
