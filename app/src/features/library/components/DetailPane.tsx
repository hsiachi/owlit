import { BookOpenIcon, MoreHorizontalIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePaperActions } from "../actions"
import { shortAuthors } from "../lib/format"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useUiStore } from "../ui-store"
import { PaperInfo } from "./PaperInfo"
import { PaperDropdownContent } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { StatusIcon, StatusSelect } from "./StatusSelect"
import { TagPicker } from "./TagsEditor"

const MAX_LISTED = 6

// Right of the list: one selected paper in full, or the actions that apply to several
export function DetailPane() {
  const selectedIds = useUiStore((s) => s.selectedIds)
  const activeId = useUiStore((s) => s.activeId)
  const setDetailOpen = useUiStore((s) => s.setDetailOpen)
  const papers = useLibraryStore((s) => s.papers)

  const selected = selectedIds.map((id) => papers[id]).filter((p): p is Paper => !!p)
  const active = activeId ? papers[activeId] : undefined

  return (
    <aside className="relative flex w-[340px] shrink-0 flex-col border-l">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Close details"
        onClick={() => setDetailOpen(false)}
        className="absolute top-2.5 right-2.5 z-10 text-muted-foreground"
      >
        <XIcon />
      </Button>
      {selected.length > 1 ? (
        <BulkPane papers={selected} />
      ) : active ? (
        <SinglePane paper={active} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">Select a paper.</div>
      )}
    </aside>
  )
}

function SinglePane({ paper }: { paper: Paper }) {
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const actions = usePaperActions()
  const subtitle = [shortAuthors(paper.authors), paper.year].filter(Boolean).join(" · ")

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="px-5 pt-5 pb-8">
        <h2 className="pr-8 text-[15px] leading-snug font-medium text-balance">{paper.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        <div className="mt-4 flex items-center gap-1.5">
          <Button size="sm" onClick={() => actions.open(paper.id)}>
            <BookOpenIcon />
            Open
          </Button>
          <StatusSelect value={paper.status} onChange={(s) => setStatus([paper.id], s)} />
          <StarButton size="icon-sm" starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <PaperDropdownContent ids={[paper.id]} align="start" />
          </DropdownMenu>
        </div>
        <PaperInfo paper={paper} className="mt-7" />
      </div>
    </ScrollArea>
  )
}

function BulkPane({ papers }: { papers: Paper[] }) {
  const actions = usePaperActions()
  const addTag = useLibraryStore((s) => s.addTag)
  const ids = papers.map((p) => p.id)
  const allStarred = papers.every((p) => p.starred)
  const hidden = papers.length - MAX_LISTED

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-5 pt-5">
        <h2 className="pr-8 text-[15px] leading-snug font-medium">{papers.length} papers selected</h2>
        <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
          {papers.slice(0, MAX_LISTED).map((p) => (
            <li key={p.id} className="truncate">
              {p.title}
            </li>
          ))}
          {hidden > 0 && <li>and {hidden} more</li>}
        </ul>
        <div className="mt-6 flex flex-col gap-5">
          <Section label="Star">
            <Button variant="outline" size="sm" className="w-fit font-normal" onClick={() => actions.setStarred(ids, !allStarred)}>
              {allStarred ? "Unstar all" : "Star all"}
            </Button>
          </Section>
          <Section label="Mark as">
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((s) => (
                <Button key={s} variant="outline" size="sm" className="font-normal" onClick={() => actions.setStatus(ids, s)}>
                  <StatusIcon status={s} />
                  {STATUS_LABEL[s]}
                </Button>
              ))}
            </div>
          </Section>
          <Section label="Tags">
            <TagPicker onPick={(tag) => addTag(ids, tag)}>
              <Button variant="outline" size="sm" className="w-fit font-normal">
                Add a tag to all
              </Button>
            </TagPicker>
          </Section>
        </div>
      </div>
      <div className="mt-auto px-5 pb-5">
        <Button
          variant="ghost"
          size="sm"
          className="font-normal text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => actions.remove(ids)}
        >
          Remove {papers.length} papers
        </Button>
      </div>
    </div>
  )
}

function Section({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
