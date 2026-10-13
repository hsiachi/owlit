import { Button } from "@/components/ui/button"
import { usePaperActions } from "../actions"
import { stripLatex } from "../lib/latex"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"
import { PaperByline, PaperQuickActions } from "./PaperByline"
import { TagsEditor } from "./TagsEditor"

// A row opened in place: enough to decide whether to read the paper, without leaving the list.
// Clicking the card's background folds it again.
export function PaperPeek({ paper }: { paper: Paper }) {
  const setTags = useLibraryStore((s) => s.setTags)
  const closePeek = useLibraryUi((s) => s.closePeek)
  const showTag = useLibraryUi((s) => s.showTag)
  const actions = usePaperActions()
  // Never "Read": beside the status menu it would pass for marking the paper read
  const openLabel = paper.status === "reading" ? "Continue" : "Open"

  return (
    <div
      data-paper-id={paper.id}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, a, input, [role=menu]")) closePeek()
      }}
      className="-mx-1.5 my-1.5 rounded-xl border bg-card px-4 pt-3.5 pb-3 shadow-sm"
    >
      {/* The card runs the Library's wide column, but its words keep one reading measure (68ch), title and
          authors included, so the text makes one block instead of an authors line running to the card's
          edge over an abstract that stops short of it */}
      <div className="max-w-[68ch]">
        <h3 className="text-body leading-snug font-medium text-balance">{paper.title}</h3>
        <PaperByline paper={paper} className="mt-1" />
        {paper.abstract && <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-line">{stripLatex(paper.abstract)}</p>}
      </div>
      <div className="mt-3.5 flex items-center gap-1">
        <TagsEditor
          tags={paper.tags}
          onChange={(tags) => setTags(paper.id, tags)}
          onOpenTag={showTag}
          className="min-w-0 flex-1"
        />
        <PaperQuickActions paper={paper} align="end" />
        <Button size="sm" className="ml-3" onClick={() => actions.open(paper.id)}>
          {openLabel}
        </Button>
      </div>
    </div>
  )
}
