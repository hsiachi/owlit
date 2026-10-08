import { useMemo } from "react"
import { ArrowDownUpIcon, CheckIcon, SearchIcon, TagIcon, XIcon } from "lucide-react"
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  { key: "addedAt", label: "Recently added" },
  { key: "title", label: "Title" },
  { key: "year", label: "Year" },
  { key: "venue", label: "Venue" },
  { key: "status", label: "Status" },
]

export function LibraryToolbar() {
  const query = useUiStore((s) => s.query)
  const setQuery = useUiStore((s) => s.setQuery)
  const filter = useUiStore((s) => s.filter)
  const setFilter = useUiStore((s) => s.setFilter)
  const papers = useLibraryStore((s) => s.papers)
  const counts = useMemo(() => countByFilter(papers), [papers])

  return (
    <div className="flex flex-col gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <h1 className="mr-2 text-base font-medium">Library</h1>
        <InputGroup className="w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search title, author, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => setQuery("")}>
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <div className="flex-1" />
        <TagFilter />
        <SortMenu />
        <AddPaperPopover />
      </div>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
        <TabsList variant="line" className="h-7">
          {FILTERS.map((f) => (
            <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
              {f.label}
              <span className="text-xs text-muted-foreground tabular-nums">{counts[f.id]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
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
        <Button variant={selected.length ? "secondary" : "ghost"} size="sm">
          <TagIcon />
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
                  <TagIcon />
                  <span className="flex-1 truncate">{tag}</span>
                  {selected.includes(tag) && <CheckIcon className="text-muted-foreground" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full" onClick={clearTags}>
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
  const current = SORTS.find((s) => s.key === sort.key)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Sort">
          <ArrowDownUpIcon />
          {current?.label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={sort.key} onValueChange={(v) => sortBy(v as SortKey)}>
          {SORTS.map((s) => (
            <DropdownMenuRadioItem key={s.key} value={s.key}>
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
