import { useEffect, useMemo, useRef } from "react"
import { ArrowDownUpIcon, CheckIcon, SearchIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { countByFilter } from "../lib/filter"
import { collectTags, useLibraryStore } from "../store"
import { type SortKey, type StatusFilter, useUiStore } from "../ui-store"
import { AddPaperPopover } from "./AddPaperPopover"

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "starred", label: "Starred" },
  { id: "unread", label: "Unread" },
  { id: "reading", label: "Reading" },
  { id: "read", label: "Read" },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: "addedAt", label: "Date added" },
  { key: "title", label: "Title" },
  { key: "year", label: "Year" },
  { key: "venue", label: "Venue" },
  { key: "status", label: "Status" },
]

// Page title and Add on the first line; the ways to narrow the list on the second
export function LibraryHeader() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 pt-7 pb-3">
      <div className="flex items-center justify-between px-2">
        <h1 className="font-heading text-2xl font-medium tracking-tight">Library</h1>
        <AddPaperPopover />
      </div>
      {/* The narrowing controls wrap under the chips when the pane squeezes the column */}
      <div className="mt-5 flex flex-wrap items-center gap-x-0.5 gap-y-2">
        <FilterChips />
        <div className="ml-auto flex items-center gap-0.5">
          <SearchField />
          <TagFilter />
          <SortMenu />
        </div>
      </div>
    </div>
  )
}

function FilterChips() {
  const filter = useUiStore((s) => s.filter)
  const setFilter = useUiStore((s) => s.setFilter)
  const papers = useLibraryStore((s) => s.papers)
  const counts = useMemo(() => countByFilter(papers), [papers])

  return (
    <div className="-ml-1 flex items-center gap-0.5">
      {FILTERS.map((f) => {
        const active = f.id === filter
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={active}
            onClick={() => setFilter(f.id)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              active && "bg-foreground/8 text-foreground hover:bg-foreground/8",
            )}
          >
            {f.label}
            <span className={cn("text-xs tabular-nums", active ? "text-muted-foreground" : "text-muted-foreground/70")}>
              {counts[f.id]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function SearchField() {
  const query = useUiStore((s) => s.query)
  const setQuery = useUiStore((s) => s.setQuery)
  const input = useRef<HTMLInputElement>(null)

  // "/" anywhere on the page jumps to the search field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <InputGroup className="mr-1 w-52 border-border/70 bg-background">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        placeholder="Search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQuery("")
            e.currentTarget.blur()
          }
        }}
      />
      <InputGroupAddon align="inline-end">
        {query ? (
          <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}>
            <XIcon />
          </InputGroupButton>
        ) : (
          <Kbd className="bg-transparent">/</Kbd>
        )}
      </InputGroupAddon>
    </InputGroup>
  )
}

function TagFilter() {
  const selected = useUiStore((s) => s.tags)
  const toggleTag = useUiStore((s) => s.toggleTag)
  const clearTags = useUiStore((s) => s.clearTags)
  const papers = useLibraryStore((s) => s.papers)
  const allTags = useMemo(() => collectTags(papers), [papers])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("font-normal text-muted-foreground", selected.length > 0 && "bg-foreground/8 text-foreground")}
        >
          {selected.length === 0 ? "Tags" : selected.length === 1 ? selected[0] : `${selected.length} tags`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Filter by tag" />
          <CommandList>
            <CommandEmpty>No tags.</CommandEmpty>
            <CommandGroup>
              {allTags.map((tag) => (
                <CommandItem key={tag} value={tag} onSelect={() => toggleTag(tag)}>
                  <span className="flex-1 truncate">{tag}</span>
                  {selected.includes(tag) && <CheckIcon className="text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full font-normal" onClick={clearTags}>
                Clear
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function SortMenu() {
  const sort = useUiStore((s) => s.sort)
  const sortBy = useUiStore((s) => s.sortBy)
  const setSortDesc = useUiStore((s) => s.setSortDesc)
  const current = SORTS.find((s) => s.key === sort.key)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-muted-foreground" aria-label="Sort">
          <ArrowDownUpIcon />
          {current?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={sort.key} onValueChange={(v) => v !== sort.key && sortBy(v as SortKey)}>
          {SORTS.map((s) => (
            <DropdownMenuRadioItem key={s.key} value={s.key}>
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort.desc ? "desc" : "asc"} onValueChange={(v) => setSortDesc(v === "desc")}>
          <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
