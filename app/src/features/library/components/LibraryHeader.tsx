import { useEffect, useMemo, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { CheckIcon, ChevronDownIcon, ListIcon, PaperclipIcon, SearchIcon, Table2Icon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { countByFilter } from "../lib/filter"
import { collectTags, useLibraryStore } from "../store"
import { type Layout, usePrefsStore } from "../prefs-store"
import { type SortKey, type StatusFilter, useUiStore } from "../ui-store"
import { TagDot } from "./TagsEditor"

// The Library's two pages, as underline tabs under its title. A third (Feed) can join later.
const PAGES = [
  { path: "/library/up-next", label: "Up next" },
  { path: "/library", label: "All papers" },
]

export function LibraryHeader({ actions }: { actions?: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const current = pathname === "/library/up-next" ? "/library/up-next" : "/library"
  return (
    <header className="px-0.5">
      <h1 className="text-[22px] leading-tight font-medium tracking-tight">Library</h1>
      <div className="mt-3 flex items-center gap-2">
        <Tabs value={current} onValueChange={(v) => navigate(v)}>
          <TabsList variant="line" className="-ml-1.5">
            {PAGES.map((p) => (
              <TabsTrigger key={p.path} value={p.path} className="px-1.5">
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        {actions}
      </div>
    </header>
  )
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "addedAt", label: "Recently added" },
  { key: "year", label: "Year" },
  { key: "title", label: "Title" },
  { key: "authors", label: "Authors" },
]

export function SortMenu() {
  const sort = useUiStore((s) => s.sort)
  const sortBy = useUiStore((s) => s.sortBy)
  const current = SORTS.find((s) => s.key === sort.key) ?? { label: "Venue" }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground">
          {current.label}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {SORTS.map((s) => (
          <DropdownMenuItem key={s.key} onSelect={() => s.key !== sort.key && sortBy(s.key)}>
            {s.label}
            {s.key === sort.key && <CheckIcon className="ml-auto text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const LAYOUTS: { id: Layout; label: string; icon: typeof ListIcon }[] = [
  { id: "list", label: "List", icon: ListIcon },
  { id: "table", label: "Table", icon: Table2Icon },
]

export function LayoutToggle() {
  const layout = usePrefsStore((s) => s.layout)
  const setLayout = usePrefsStore((s) => s.setLayout)
  const closePeek = useUiStore((s) => s.closePeek)
  return (
    <div role="radiogroup" aria-label="Layout" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {LAYOUTS.map((l) => (
        <Tooltip key={l.id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="radio"
              aria-checked={layout === l.id}
              aria-label={l.label}
              onClick={() => {
                setLayout(l.id)
                closePeek()
              }}
              className={cn(
                "grid h-6 w-7 place-items-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50",
                layout === l.id && "bg-card text-foreground shadow-xs",
              )}
            >
              <l.icon className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{l.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

// One field to find and to add: words filter the list, a DOI / arXiv id / link offers to add.
// A bright field on the sheet; focus darkens its border.
export function FindField({ onSubmit, onPickFiles }: { onSubmit: () => void; onPickFiles: (files: File[]) => void }) {
  const query = useUiStore((s) => s.query)
  const setQuery = useUiStore((s) => s.setQuery)
  const input = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // "/" anywhere on the page jumps to the field
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
    <div className="mt-4 flex h-11 items-center gap-2 rounded-xl border bg-card pr-1.5 pl-3.5 transition-colors focus-within:border-foreground/30">
      <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit()
          if (e.key === "Escape") {
            setQuery("")
            e.currentTarget.blur()
          }
        }}
        placeholder="Search, or paste a DOI, arXiv id or link to add"
        aria-label="Search or add papers"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
      />
      {query ? (
        <Button variant="ghost" size="icon-sm" aria-label="Clear" onClick={() => setQuery("")} className="text-muted-foreground">
          <XIcon />
        </Button>
      ) : (
        <Kbd className="bg-transparent">/</Kbd>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Add a PDF file" onClick={() => fileInput.current?.click()} className="text-muted-foreground">
            <PaperclipIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add a PDF file</TooltipContent>
      </Tooltip>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          onPickFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
    </div>
  )
}

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reading", label: "Reading" },
  { id: "starred", label: "Starred" },
  { id: "unread", label: "Unread" },
  { id: "read", label: "Read" },
]

const chip = "flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50"

// Status chips on the left, the tag filter on the right of the same line
export function FilterBar() {
  const filter = useUiStore((s) => s.filter)
  const setFilter = useUiStore((s) => s.setFilter)
  const tags = useUiStore((s) => s.tags)
  const toggleTag = useUiStore((s) => s.toggleTag)
  const papers = useLibraryStore((s) => s.papers)
  const counts = useMemo(() => countByFilter(papers), [papers])

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-0.5">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={filter === f.id}
          onClick={() => setFilter(f.id)}
          className={cn(chip, filter === f.id && "bg-accent text-foreground hover:bg-accent")}
        >
          {f.label}
          <span className="text-xs tabular-nums">{counts[f.id]}</span>
        </button>
      ))}
      <span className="flex-1" />
      {tags.map((t) => (
        <button key={t} type="button" onClick={() => toggleTag(t)} aria-label={`Stop filtering by ${t}`} className={cn(chip, "bg-accent pr-2 pl-2.5 text-foreground hover:bg-accent")}>
          <TagDot tag={t} />
          {t}
          <XIcon className="size-3.5 text-muted-foreground" />
        </button>
      ))}
      <TagMenu />
    </div>
  )
}

function TagMenu() {
  const selected = useUiStore((s) => s.tags)
  const toggleTag = useUiStore((s) => s.toggleTag)
  const papers = useLibraryStore((s) => s.papers)
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of Object.values(papers)) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return collectTags(papers).map((t) => [t, counts.get(t) ?? 0] as const)
  }, [papers])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(chip, "pr-2 data-[state=open]:bg-muted data-[state=open]:text-foreground")}>
          Tags
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-52">
        {tags.length === 0 && <div className="px-2 py-1.5 text-[13px] text-muted-foreground">No tags yet.</div>}
        {tags.map(([t, n]) => (
          // Keep the menu open so several tags can be picked in a row
          <DropdownMenuItem key={t} onSelect={(e) => { e.preventDefault(); toggleTag(t) }}>
            <TagDot tag={t} />
            <span className="flex-1 truncate">{t}</span>
            {selected.includes(t) ? <CheckIcon className="text-muted-foreground" /> : <span className="text-xs text-muted-foreground tabular-nums">{n}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
