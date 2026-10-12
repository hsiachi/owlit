import { ChevronDownIcon, XIcon } from "lucide-react"
import { ChoiceMenu } from "@/components/choice-menu"
import { IconButton } from "@/components/icon-button"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { usePaperActions } from "../actions"
import { STATUS_OPTIONS } from "../lib/status"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"
import { TagPicker } from "./TagsEditor"

// Floats at the bottom of the page while two or more papers are selected
export function BulkBar() {
  const ids = useLibraryUi((s) => s.selectedIds)
  const clearSelection = useLibraryUi((s) => s.clearSelection)
  const papers = useLibraryStore((s) => s.papers)
  const addTag = useLibraryStore((s) => s.addTag)
  const actions = usePaperActions()
  if (ids.length < 2) return null
  const allStarred = ids.every((id) => papers[id]?.starred)

  return (
    <div className="menu-surface absolute bottom-5 left-1/2 z-20 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-xl pr-1.5 pl-4 text-detail whitespace-nowrap">
      <span className="mr-2">{ids.length} selected</span>
      <Button variant="ghost" size="sm" className="font-normal" onClick={() => actions.setStarred(ids, !allStarred)}>
        {allStarred ? "Unstar" : "Star"}
      </Button>
      <ChoiceMenu label="Mark as" options={STATUS_OPTIONS} onChange={(s) => actions.setStatus(ids, s)} side="top" align="start" className="text-foreground" />
      <TagPicker onPick={(tag) => addTag(ids, tag)}>
        <Button variant="ghost" size="sm" className="font-normal">
          Add tag
          <ChevronDownIcon />
        </Button>
      </TagPicker>
      <Button variant="ghost" size="sm" className="font-normal" onClick={() => actions.copyBibtex(ids.map((id) => papers[id]).filter(Boolean))}>
        Copy BibTeX
      </Button>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <Button variant="ghost" size="sm" className="font-normal text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => actions.remove(ids)}>
        Remove
      </Button>
      <IconButton label="Clear selection" onClick={clearSelection}>
        <XIcon />
      </IconButton>
    </div>
  )
}
