import { BookOpenIcon, MoreHorizontalIcon, StarIcon, StarOffIcon, TagIcon, Trash2Icon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import type { Paper, ReadStatus } from "../types"
import { useUiStore } from "../ui-store"
import { PaperInfo } from "./PaperInfo"
import { PaperDropdownContent } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import { StatusIcon } from "./StatusSelect"
import { TagPicker } from "./TagsEditor"

// Right of the table: one selected paper in full, or the actions that apply to several
export function DetailPane() {
  const selectedIds = useUiStore((s) => s.selectedIds)
  const activeId = useUiStore((s) => s.activeId)
  const setDetailOpen = useUiStore((s) => s.setDetailOpen)
  const papers = useLibraryStore((s) => s.papers)

  const selected = selectedIds.map((id) => papers[id]).filter((p): p is Paper => !!p)
  const active = activeId ? papers[activeId] : undefined

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l">
      {selected.length > 1 ? (
        <BulkPane papers={selected} onClose={() => setDetailOpen(false)} />
      ) : active ? (
        <SinglePane paper={active} onClose={() => setDetailOpen(false)} />
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          Select a paper.
        </div>
      )}
    </aside>
  )
}

function SinglePane({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const actions = usePaperActions()

  return (
    <>
      <header className="flex items-start gap-1 border-b p-3 pl-4">
        <h2 className="flex-1 pt-1 text-sm font-medium leading-snug">{paper.title}</h2>
        <StarButton starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <PaperDropdownContent ids={[paper.id]} />
        </DropdownMenu>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          <PaperInfo paper={paper} />
        </div>
      </ScrollArea>
      <footer className="flex gap-2 border-t p-3">
        <Button className="flex-1" onClick={() => actions.open(paper.id)}>
          <BookOpenIcon />
          Open
        </Button>
        <Button variant="outline" onClick={() => actions.editDetails(paper.id)}>
          Edit details
        </Button>
      </footer>
    </>
  )
}

function BulkPane({ papers, onClose }: { papers: Paper[]; onClose: () => void }) {
  const actions = usePaperActions()
  const addTag = useLibraryStore((s) => s.addTag)
  const ids = papers.map((p) => p.id)
  const allStarred = papers.every((p) => p.starred)

  return (
    <>
      <header className="flex items-center gap-1 border-b p-3 pl-4">
        <h2 className="flex-1 text-sm font-medium">{papers.length} papers selected</h2>
        <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      <div className="flex flex-col gap-5 p-4">
        <Section label="Star">
          <Button variant="outline" size="sm" onClick={() => actions.setStarred(ids, !allStarred)}>
            {allStarred ? <StarOffIcon /> : <StarIcon />}
            {allStarred ? "Unstar all" : "Star all"}
          </Button>
        </Section>
        <Section label="Status">
          <div className="flex flex-wrap gap-2">
            {STATUS_ORDER.map((s: ReadStatus) => (
              <Button key={s} variant="outline" size="sm" onClick={() => actions.setStatus(ids, s)}>
                <StatusIcon status={s} />
                {STATUS_LABEL[s]}
              </Button>
            ))}
          </div>
        </Section>
        <Section label="Tags">
          <TagPicker onPick={(tag) => addTag(ids, tag)}>
            <Button variant="outline" size="sm">
              <TagIcon />
              Add a tag to all
            </Button>
          </TagPicker>
        </Section>
        <Section label="Selected">
          <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {papers.map((p) => (
              <li key={p.id} className="truncate">
                {p.title}
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <footer className="mt-auto border-t p-3">
        <Button variant="outline" className="w-full text-destructive" onClick={() => actions.remove(ids)}>
          <Trash2Icon />
          Remove {papers.length} papers
        </Button>
      </footer>
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}
