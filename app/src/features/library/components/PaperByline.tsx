import { EllipsisVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ActionsDropdownContent } from "@/components/action-menu"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { PaperMenu } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { StatusMenu } from "./StatusMenu"

// Under a paper's title, in the peek and on the paper page: the authors, then venue · year
export function PaperByline({ paper, className }: { paper: Paper; className?: string }) {
  const published = [paper.venue, paper.year].filter(Boolean).join(" · ")
  return (
    <p className={cn("text-detail leading-normal text-muted-foreground", className)}>
      {paper.authors.join(", ") || "Unknown authors"}
      {published && (
        <>
          <br />
          {published}
        </>
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
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions" className="text-muted-foreground">
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        {/* Focus goes back to the ⋯ on close, as from any other button */}
        <ActionsDropdownContent align={align} className="w-48" onCloseAutoFocus={() => undefined}>
          <PaperMenu ids={[paper.id]} afterRemove={afterRemove} />
        </ActionsDropdownContent>
      </DropdownMenu>
    </>
  )
}
