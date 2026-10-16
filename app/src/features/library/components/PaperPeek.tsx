import { t } from "@lingui/core/macro"
import { Button } from "@/components/ui/button"
import { usePaperActions } from "../actions"
import { stripLatex } from "../lib/latex"
import { useLibraryStore } from "../store"
import type { Paper } from "@owlit/protocol"
import { useLibraryUi } from "../ui-store"
import { PaperByline, PaperQuickActions } from "./PaperByline"
import { StatusMenu } from "./StatusMenu"
import { TagsEditor } from "./TagsEditor"

// What a row's card holds under its title line: enough to decide whether to read the paper, without
// leaving the list. It is text, not a control: clicks, drags and double-clicks here select words and never
// fold or open anything (lib/use-list-keys.ts). In the list the card's first line is the row, which keeps
// its star and ⋯, so the card ends with the status alone; the table's row has no such slot (`rowActions`).
export function PaperPeek({ paper, rowActions, className }: { paper: Paper; rowActions?: boolean; className?: string }) {
  const setTags = useLibraryStore((s) => s.setTags)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const showTag = useLibraryUi((s) => s.showTag)
  const actions = usePaperActions()
  // Never "Read": beside the status menu it would pass for marking the paper read
  const openLabel = paper.status === "reading" ? t({ message: "Continue", comment: "button: go on reading a paper" }) : t({ message: "Open", comment: "button: open a paper to read" })

  return (
    <div data-peek-body className={className}>
      {/* The card runs the Library's wide column, but its words keep one reading measure (68ch), so the text
          makes one block instead of an authors line running to the card's edge over an abstract that stops
          short of it */}
      <div className="max-w-[68ch]">
        <PaperByline paper={paper} />
        {paper.abstract && <p className="mt-2.5 text-sm leading-relaxed whitespace-pre-line">{stripLatex(paper.abstract)}</p>}
      </div>
      <div className="mt-3.5 flex items-center gap-1">
        <TagsEditor tags={paper.tags} onChange={(tags) => setTags(paper.id, tags)} onOpenTag={showTag} className="min-w-0 flex-1" />
        {rowActions ? <PaperQuickActions paper={paper} align="end" /> : <StatusMenu value={paper.status} onChange={(s) => setStatus([paper.id], s)} align="end" />}
        <Button size="sm" className="ml-3" onClick={() => actions.open(paper.id)}>
          {openLabel}
        </Button>
      </div>
    </div>
  )
}
