import { t } from "@lingui/core/macro"
import { useMemo, useRef } from "react"
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
import { IconButton } from "@/components/icon-button"
import { countByFilter } from "../lib/filter"
import { collectTags, useLibraryStore } from "../store"
import { useThreadsStore } from "@/features/threads/store"
import { threadsByPaper } from "@/features/threads/lib"
import { type Layout, usePrefsStore } from "../prefs-store"
import { type SortKey, type StatusFilter, useLibraryUi } from "../ui-store"
import { useScopePapers } from "../scope"
import { projectChoices, useProjects } from "@/features/projects/store"
import { TagDot } from "./TagsEditor"

// scope: what narrows the whole Library to a project's papers, beside the title it narrows
export function LibraryHeader({ scope, actions }: { scope?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-2 px-0.5">
      <PageTitle>{t`Library`}</PageTitle>
      {scope}
      <span className="flex-1" />
      {actions}
    </header>
  )
}

// The Library as one project's papers, or all of them: a menu of the marked projects by name, and inside
// one, whether its current drafts' citations or everything its docs cite. Only once the workspace has a
// project; without one the Library has nothing of this.
export function ScopeControls() {
  const projects = useProjects()
  const scope = useLibraryUi((s) => s.scope)
  const setScope = useLibraryUi((s) => s.setScope)
  const options = useMemo(
    () => [
      { value: "", label: t({ message: "All papers", comment: "Library scope menu: every paper, of no one project" }) },
      ...projectChoices(projects).map((c) => ({ value: c.project.path, label: c.label })),
    ],
    [projects],
  )
  if (!projects.length) return null
  return (
    <>
      <ChoiceMenu
        label={t({ message: "Project", comment: "Library menu: show the papers one project cites, or all papers" })}
        value={scope?.project ?? ""}
        options={options}
        // A project opens on what its current drafts cite, the papers its writing leans on now
        onChange={(path) => setScope(path ? { project: path, drafts: true } : null)}
        align="start"
      />
      {scope && (
        <SegmentedControl
          label={t({ message: "Papers it cites", comment: "Library: which of a project's cited papers show" })}
          value={scope.drafts ? "drafts" : "all"}
          options={[
            { value: "drafts", label: t({ message: "Current drafts", comment: "Library, in a project: the papers its current drafts cite" }) },
            { value: "all", label: t({ message: "Everything it cites", comment: "Library, in a project: the papers any of its docs cite" }) },
          ]}
          onChange={(step) => setScope({ ...scope, drafts: step === "drafts" })}
        />
      )}
    </>
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
  const { ids: within } = useScopePapers()
  const counts = useMemo(() => countByFilter(papers, within), [papers, within])

  return (
    <div className="mt-3.5 flex flex-wrap items-center gap-0.5">
      {filters().filter((f) => f.id !== "no-pdf" || counts[f.id] > 0 || filter === f.id).map((f) => (
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
      <ThreadMenu />
      <TagMenu />
    </div>
  )
}

// "In thread …": the Library's papers a thread holds, shown as the chip a list of papers is (showOnly),
// beside the Thread grouping. Offered while some thread holds a paper of the Library.
function ThreadMenu() {
  const threads = useThreadsStore((s) => s.threads)
  const papers = useLibraryStore((s) => s.papers)
  const aliases = useLibraryStore((s) => s.aliases)
  const showOnly = useLibraryUi((s) => s.showOnly)
  const held = useMemo(() => {
    const byThread = new Map<string, { id: string; title: string; ids: string[] }>()
    for (const [paperId, list] of threadsByPaper(threads, papers, aliases)) {
      for (const c of list) {
        const entry = byThread.get(c.id) ?? { id: c.id, title: c.title, ids: [] }
        entry.ids.push(paperId)
        byThread.set(c.id, entry)
      }
    }
    return [...byThread.values()]
  }, [threads, papers, aliases])
  if (!held.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(chip, "pr-2 data-[state=open]:bg-muted data-[state=open]:text-foreground")}>
          {t({ message: "In thread", comment: "filter menu: show only the papers one thread holds" })}
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64">
        {held.map((c) => {
          const title = c.title
          return (
            <DropdownMenuItem key={c.id} onSelect={() => showOnly(c.ids, t({ message: `In thread “${title}”`, comment: "chip: the Library shows only the papers of this thread" }))}>
              <span className="flex-1 truncate">{title}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{c.ids.length}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
