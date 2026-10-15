import { t } from "@lingui/core/macro"
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
import { WaitingDot } from "@/components/marks"
import { countByFilter } from "../lib/filter"
import { collectTags, useLibraryStore } from "../store"
import { type Layout, usePrefsStore } from "../prefs-store"
import { type SortKey, type StatusFilter, useLibraryUi } from "../ui-store"
import { TagDot } from "./TagsEditor"

// The Library's two pages, as underline tabs on its title's line, so the header is one row above the
// find field rather than two. A third (Feed) can join later.
const pages = () => [
  { path: "/library/up-next", label: t({ message: "Up next", comment: "Library tab: the papers to read next" }) },
  { path: "/library", label: t`All papers` },
]

export function LibraryHeader({ actions }: { actions?: React.ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const current = pathname === "/library/up-next" ? "/library/up-next" : "/library"
  return (
    <header className="flex items-center gap-2 px-0.5">
      <PageTitle className="mr-5">{t`Library`}</PageTitle>
      <Tabs value={current} onValueChange={(v) => navigate(v)}>
        <TabsList variant="line">
          {pages().map((p) => (
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

const sorts = (): { value: SortKey; label: string }[] => [
  { value: "addedAt", label: t`Recently added` },
  { value: "year", label: t`Year` },
  { value: "title", label: t`Title` },
  { value: "authors", label: t`Authors` },
  { value: "thread", label: t({ message: "Thread", comment: "sort: group the Library's papers by the thread they came from" }) },
]

export function SortMenu() {
  const sort = useLibraryUi((s) => s.sort)
  const sortBy = useLibraryUi((s) => s.sortBy)
  // Venue and citations are sorted from the table's header only
  const trigger = sort.key === "venue" ? t`Venue` : sort.key === "citations" ? t({ message: "Citations", comment: "how often a paper is cited by other works" }) : undefined
  return <ChoiceMenu label={t({ message: "Sort", comment: "menu: how the papers are ordered" })} value={sort.key} options={sorts()} onChange={sortBy} trigger={trigger} />
}

const layouts = (): { value: Layout; label: string; icon: typeof ListIcon }[] => [
  { value: "list", label: t`List`, icon: ListIcon },
  { value: "table", label: t`Table`, icon: Table2Icon },
]

export function LayoutToggle() {
  const layout = usePrefsStore((s) => s.layout)
  const setLayout = usePrefsStore((s) => s.setLayout)
  const closePeek = useLibraryUi((s) => s.closePeek)
  return (
    <SegmentedControl
      label={t`Layout`}
      value={layout}
      options={layouts()}
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
      placeholder={t`Search, or paste a DOI, arXiv id or link to add`}
      label={t`Search or add papers`}
    >
      <IconButton label={t`Add a PDF file`} onClick={() => fileInput.current?.click()}>
        <PaperclipIcon />
      </IconButton>
      <PdfFileInput ref={fileInput} multiple onFiles={onPickFiles} />
    </FindField>
  )
}

const filters = (): { id: StatusFilter; label: string }[] => [
  { id: "all", label: t({ message: "All", comment: "filter chip: every paper" }) },
  { id: "reading", label: t({ message: "Reading", comment: "reading status of a paper: being read now" }) },
  { id: "starred", label: t({ message: "Starred", comment: "filter chip: starred papers" }) },
  { id: "unread", label: t({ message: "Unread", comment: "reading status of a paper" }) },
  { id: "read", label: t({ message: "Read", comment: "reading status of a paper: finished reading (past participle)" }) },
  // Only while a publisher wants the user for some paper (or the chip is picked)
  { id: "needs", label: t({ message: "Needs you", comment: "filter chip: papers whose publisher wants the user to check or sign in" }) },
  // Every paper owlit has no PDF of, a fact rather than something to do: grey, no dot, and only while there is one
  { id: "no-pdf", label: t({ message: "No PDF", comment: "filter chip: papers owlit has no PDF of" }) },
]

const chip = "flex h-7 items-center gap-1.5 rounded-full px-3 text-detail text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-key:ring-2 focus-key:ring-ring/50"

// Status chips on the left, the tag filter on the right of the same line
export function FilterBar() {
  const filter = useLibraryUi((s) => s.filter)
  const setFilter = useLibraryUi((s) => s.setFilter)
  const tags = useLibraryUi((s) => s.tags)
  const toggleTag = useLibraryUi((s) => s.toggleTag)
  const only = useLibraryUi((s) => s.only)
  const clearOnly = useLibraryUi((s) => s.clearOnly)
  const papers = useLibraryStore((s) => s.papers)
  const counts = useMemo(() => countByFilter(papers), [papers])

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-0.5">
      {filters().filter((f) => !(f.id === "needs" || f.id === "no-pdf") || counts[f.id] > 0 || filter === f.id).map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={filter === f.id}
          onClick={() => setFilter(f.id)}
          className={cn(chip, filter === f.id && "bg-accent text-foreground hover:bg-accent")}
        >
          {/* Needs you carries the rail's dot, so the trail from the rail goes on to the papers that wait */}
          {f.id === "needs" && <WaitingDot className="size-1.5" />}
          {f.label}
          <span className="text-xs tabular-nums">{counts[f.id]}</span>
        </button>
      ))}
      <span className="flex-1" />
      {only && (
        <button type="button" onClick={clearOnly} aria-label={t`Stop showing only ${only.label}`} className={cn(chip, "bg-accent pr-2 pl-2.5 text-foreground hover:bg-accent")}>
          {only.label}
          <XIcon className="size-3.5 text-muted-foreground" />
        </button>
      )}
      {tags.map((tag) => (
        <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-label={t`Stop filtering by ${tag}`} className={cn(chip, "bg-accent pr-2 pl-2.5 text-foreground hover:bg-accent")}>
          <TagDot tag={tag} />
          {tag}
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
          {t`Tags`}
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-52">
        {tags.length === 0 && <div className="px-2 py-1.5 text-detail text-muted-foreground">{t`No tags yet.`}</div>}
        {tags.map(([tag, n]) => (
          // Keep the menu open so several tags can be picked in a row
          <DropdownMenuItem key={tag} onSelect={(e) => { e.preventDefault(); toggleTag(tag) }}>
            <TagDot tag={tag} />
            <span className="flex-1 truncate">{tag}</span>
            {selected.includes(tag) ? <CheckIcon className="text-muted-foreground" /> : <span className="text-xs text-muted-foreground tabular-nums">{n}</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
