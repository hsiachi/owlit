import { t } from "@lingui/core/macro"
import type { Paper } from "@owlit/protocol"
import { PaperCard } from "@/components/paper-card"
import { Button } from "@/components/ui/button"
import { usePaperActions } from "../actions"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"
import { PaperQuickActions } from "./PaperByline"
import { StatusMenu } from "./StatusMenu"
import { TagsEditor } from "./TagsEditor"

// A Library row's card (components/paper-card.tsx), ending in the Library's own actions: the tags, the
// reading status and Open. In the list the card's first line is the row, which keeps its star and ⋯, so
// the card ends with the status alone; the table's row has no such slot (`rowActions`).
export function PaperPeek({ paper, rowActions, className }: { paper: Paper; rowActions?: boolean; className?: string }) {
  const setTags = useLibraryStore((s) => s.setTags)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const showTag = useLibraryUi((s) => s.showTag)
  const actions = usePaperActions()
  // Never "Read": beside the status menu it would pass for marking the paper read
  const openLabel = paper.status === "reading" ? t({ message: "Continue", comment: "button: go on reading a paper" }) : t({ message: "Open", comment: "button: open a paper to read" })

  return (
    <PaperCard
      facts={paper}
      paper={paper}
      className={className}
      footer={
        <>
          <TagsEditor tags={paper.tags} onChange={(tags) => setTags(paper.id, tags)} onOpenTag={showTag} className="min-w-0 flex-1" />
          {rowActions ? <PaperQuickActions paper={paper} align="end" /> : <StatusMenu paper={paper} onChange={(s) => setStatus([paper.id], s)} align="end" />}
          <Button size="sm" className="ml-3" onClick={() => actions.open(paper.id)}>
            {openLabel}
          </Button>
        </>
      }
    />
  )
}
