import { EllipsisVerticalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useUiStore } from "../ui-store"
import { PaperDropdownContent } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { StatusMenu } from "./StatusMenu"
import { TagsEditor } from "./TagsEditor"

// A row opened in place: enough to decide whether to read the paper, without leaving the list.
// Clicking the card's background folds it again.
export function PaperPeek({ paper }: { paper: Paper }) {
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const setTags = useLibraryStore((s) => s.setTags)
  const closePeek = useUiStore((s) => s.closePeek)
  const showTag = useUiStore((s) => s.showTag)
  const actions = usePaperActions()
  const published = [paper.venue, paper.year].filter(Boolean).join(" · ")
  const openLabel = !paper.pdf ? "Open" : paper.status === "reading" ? "Continue" : "Read"

  return (
    <div
      data-paper-id={paper.id}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, input, [role=menu]")) closePeek()
      }}
      className="-mx-1.5 my-1.5 rounded-xl border bg-card px-4 pt-3.5 pb-3 shadow-sm"
    >
      <h3 className="text-body leading-snug font-medium text-balance">{paper.title}</h3>
      <p className="mt-1 text-detail leading-normal text-muted-foreground">
        {paper.authors.join(", ") || "Unknown authors"}
        {published && (
          <>
            <br />
            {published}
          </>
        )}
      </p>
      {paper.abstract && <p className="mt-2.5 max-w-[68ch] text-sm leading-relaxed">{paper.abstract}</p>}
      <div className="mt-3.5 flex items-center gap-1">
        <TagsEditor
          tags={paper.tags}
          onChange={(tags) => setTags(paper.id, tags)}
          onOpenTag={showTag}
          className="min-w-0 flex-1"
        />
        <StatusMenu value={paper.status} onChange={(s) => setStatus([paper.id], s)} />
        <StarButton starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <PaperDropdownContent ids={[paper.id]} />
        </DropdownMenu>
        <Button size="sm" className="ml-1.5" onClick={() => actions.open(paper.id)}>
          {openLabel}
        </Button>
      </div>
    </div>
  )
}
