import { CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { usePaperActions } from "../actions"
import { shortAuthors } from "../lib/format"
import type { Lookup } from "../lib/use-ref-lookup"

// The one card that replaces the list while the find field holds a reference
export function AddCandidate({ lookup, onAdd, input }: { lookup: Lookup | null; onAdd: () => void; input: string }) {
  const actions = usePaperActions()
  if (!lookup) return null
  return (
    <div className="mt-5 flex items-center gap-3.5 rounded-xl border bg-card py-3 pr-3.5 pl-4">
      {lookup.state === "loading" && (
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner className="size-3.5" />
          Looking up {input}…
        </div>
      )}
      {lookup.state === "error" && <div className="text-[13px] text-muted-foreground">{lookup.message}</div>}
      {lookup.state === "found" && (
        <>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground">Add to library</div>
            <div className="mt-0.5 truncate text-sm font-medium">{lookup.resolved.title}</div>
            <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
              {[shortAuthors(lookup.resolved.authors), lookup.resolved.year, lookup.resolved.venue, lookup.resolved.pdf && "PDF available"]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          <Kbd className="bg-transparent">↵</Kbd>
          <Button size="sm" onClick={onAdd}>
            Add
          </Button>
        </>
      )}
      {lookup.state === "exists" && (
        <>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckIcon className="size-3.5" />
              Already in your library
            </div>
            <div className="mt-0.5 truncate text-sm font-medium">{lookup.paper.title}</div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {[shortAuthors(lookup.paper.authors), lookup.paper.year].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => actions.open(lookup.paper.id)}>
            Open
          </Button>
        </>
      )}
    </div>
  )
}
