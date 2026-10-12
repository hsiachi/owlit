import { useMemo, useRef } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { CheckIcon, ChevronDownIcon, ListIcon, PaperclipIcon, Table2Icon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ChoiceMenu } from "@/components/choice-menu"
import { SegmentedControl } from "@/components/segmented-control"
import { PdfFileInput } from "@/components/file-drop"
import { FindField } from "@/components/find-field"
import { PageTitle } from "@/components/page"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IconButton } from "@/components/icon-button"
import { countByFilter } from "../lib/filter"
import { collectTags, useLibraryStore } from "../store"
import { type Layout, usePrefsStore } from "../prefs-store"
import { type SortKey, type StatusFilter, useLibraryUi } from "../ui-store"
import { TagDot } from "./TagsEditor"

// The Library's two pages, as underline tabs on its title's line, so the header is one row above the
// find field rather than two. A third (Feed) can join later.
const PAGES = [
  { path: "/library/up-next", label: "Up next" },
  { path: "/library", label: "All papers" },
]

export function LibraryHeader({ actions }: { actions?: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const current = pathname === "/library/up-next" ? "/library/up-next" : "/library"
  return (
    <header className="flex items-center gap-2 px-0.5">
      <PageTitle className="mr-5">Library</PageTitle>
      <Tabs value={current} onValueChange={(v) => navigate(v)}>
        <TabsList variant="line">
          {PAGES.map((p) => (
            <TabsTrigger key={p.path} value={p.path} className="px-1.5">
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <span className="flex-1" />
      {actions}
    </header>
  )
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: "addedAt", label: "Recently added" },
  { value: "year", label: "Year" },
  { value: "title", label: "Title" },
  { value: "authors", label: "Authors" },
]

export function SortMenu() {
  const sort = useLibraryUi((s) => s.sort)
  const sortBy = useLibraryUi((s) => s.sortBy)
  // Venue is sorted from the table's header only
  const trigger = sort.key === "venue" ? "Venue" : undefined
  return <ChoiceMenu label="Sort" value={sort.key} options={SORTS} onChange={sortBy} trigger={trigger} />
}

const LAYOUTS: { value: Layout; label: string; icon: typeof ListIcon }[] = [
  { value: "list", label: "List", icon: ListIcon },
  { value: "table", label: "Table", icon: Table2Icon },
]

export function LayoutToggle() {
  const layout = usePrefsStore((s) => s.layout)
  const setLayout = usePrefsStore((s) => s.setLayout)
  const closePeek = useLibraryUi((s) => s.closePeek)
  return (
    <SegmentedControl
      label="Layout"
      value={layout}
      options={LAYOUTS}
      onChange={(l) => {
        setLayout(l)
        closePeek()
      }}
    />
  )
}

// One field to find and to add: words filter the list, a DOI / arXiv id / link offers to add
export function LibraryFindField({ onSubmit, onPickFiles }: { onSubmit: () => void; onPickFiles: (files: File[]) => void }) {
  const query = useLibraryUi((s) => s.query)
  const setQuery = useLibraryUi((s) => s.setQuery)
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <FindField
      value={query}
      onChange={setQuery}
      onEnter={onSubmit}
      placeholder="Search, or paste a DOI, arXiv id or link to add"
      label="Search or add papers"
    >
      <IconButton label="Add a PDF file" onClick={() => fileInput.current?.click()}>
        <PaperclipIcon />
      </IconButton>
      <PdfFileInput ref={fileInput} multiple onFiles={onPickFiles} />
    </FindField>
  )
}

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reading", label: "Reading" },
  { id: "starred", label: "Starred" },
  { id: "unread", label: "Unread" },
  { id: "read", label: "Read" },
  // Only while a publisher wants the user for some paper (or the chip is picked)
  { id: "needs", label: "Needs you" },
]

const chip = "flex h-7 items-center gap-1.5 rounded-full px-3 text-detail text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50"

// Status chips on the left, the tag filter on the right of the same line
export function FilterBar() {
  const filter = useLibraryUi((s) => s.filter)
  const setFilter = useLibraryUi((s) => s.setFilter)
  const tags = useLibraryUi((s) => s.tags)
  const toggleTag = useLibraryUi((s) => s.toggleTag)
  const papers = useLibraryStore((s) => s.papers)
  const counts = useMemo(() => countByFilter(papers), [papers])

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-0.5">
      {FILTERS.filter((f) => f.id !== "needs" || counts.needs > 0 || filter === "needs").map((f) => (
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
  const selected = useLibraryUi((s) => s.tags)
  const toggleTag = useLibraryUi((s) => s.toggleTag)
  const papers = useLibraryStore((s) => s.papers)
  const tags = useMemo(() => collectTags(papers), [papers])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(chip, "pr-2 data-[state=open]:bg-muted data-[state=open]:text-foreground")}>
          Tags
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-52">
        {tags.length === 0 && <div className="px-2 py-1.5 text-detail text-muted-foreground">No tags yet.</div>}
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
