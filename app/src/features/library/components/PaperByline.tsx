import { t } from "@lingui/core/macro"
import { cn } from "@/lib/utils"
import { ActionsDropdownContent, MenuButton } from "@/components/action-menu"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { citationsSource, citationsText } from "../lib/format"
import { useLibraryStore } from "../store"
import type { Paper } from "@owlit/protocol"
import { PaperMenu } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { StatusMenu } from "./StatusMenu"

// Under a paper's title, in the peek and on the paper page: the authors, then venue · year · citations,
// the count saying on hover who counted it and when
export function PaperByline({ paper, className }: { paper: Paper; className?: string }) {
  const published = [paper.venue, paper.year].filter(Boolean).join(" · ")
  const citations = paper.citations
  return (
    <p className={cn("text-detail leading-normal text-muted-foreground", className)}>
      {paper.authors.join(", ") || t`Unknown authors`}
      {(published || citations) && <br />}
      {published}
      {published && citations && " · "}
      {citations && (
        <span className="tabular-nums" title={citationsSource(citations)}>
          {citationsText(citations.count)}
        </span>
      )}
    </p>
  )
}

// Reading status, star and the paper's ⋯ menu, in the peek and on the paper page
export function PaperQuickActions({ paper, align, afterRemove }: { paper: Paper; align: "start" | "end"; afterRemove?: () => void }) {
  const setStatus = useLibraryStore((s) => s.setStatus)
  const setStarred = useLibraryStore((s) => s.setStarred)
  return (
    <>
      <StatusMenu value={paper.status} onChange={(s) => setStatus([paper.id], s)} align={align} />
      <StarButton starred={paper.starred} onToggle={() => setStarred([paper.id], !paper.starred)} />
      <DropdownMenu>
        <MenuButton label={t`More actions`} />
        {/* Focus goes back to the ⋯ on close, as from any other button */}
        <ActionsDropdownContent align={align} className="w-48" onCloseAutoFocus={() => undefined}>
          <PaperMenu ids={[paper.id]} afterRemove={afterRemove} />
        </ActionsDropdownContent>
      </DropdownMenu>
    </>
  )
}
