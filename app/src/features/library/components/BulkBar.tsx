import { ChevronDownIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import { STATUS_LABEL, STATUS_ORDER } from "../lib/status"
import { useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"
import { TagPicker } from "./TagsEditor"

// Floats at the bottom of the page while two or more papers are selected
export function BulkBar() {
  const ids = useUiStore((s) => s.selectedIds)
  const clearSelection = useUiStore((s) => s.clearSelection)
  const papers = useLibraryStore((s) => s.papers)
  const addTag = useLibraryStore((s) => s.addTag)
  const actions = usePaperActions()
  if (ids.length < 2) return null
  const allStarred = ids.every((id) => papers[id]?.starred)

  return (
    <div className="absolute bottom-5 left-1/2 z-20 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-xl border bg-popover pr-1.5 pl-4 text-[13px] whitespace-nowrap shadow-lg">
      <span className="mr-2">{ids.length} selected</span>
      <Button variant="ghost" size="sm" className="font-normal" onClick={() => actions.setStarred(ids, !allStarred)}>
        {allStarred ? "Unstar" : "Star"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="font-normal">
            Mark as
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" className="w-40">
          {STATUS_ORDER.map((s) => (
            <DropdownMenuItem key={s} onSelect={() => actions.setStatus(ids, s)}>
              {STATUS_LABEL[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <TagPicker onPick={(tag) => addTag(ids, tag)}>
        <Button variant="ghost" size="sm" className="font-normal">
          Add tag
          <ChevronDownIcon />
        </Button>
      </TagPicker>
      <Button variant="ghost" size="sm" className="font-normal" onClick={() => actions.copyBibtex(ids.map((id) => papers[id]).filter(Boolean))}>
        Copy BibTeX
      </Button>
      <span className="mx-1 h-4 w-px bg-border" />
      <Button variant="ghost" size="sm" className="font-normal text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => actions.remove(ids)}>
        Remove
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Clear selection" onClick={clearSelection} className="text-muted-foreground">
        <XIcon />
      </Button>
    </div>
  )
}
