import { plural, t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { RowList, revealOnHover, rowClass } from "@/components/row-list"
import { FoldButton } from "@/components/fold"
import { Unfold } from "@/components/unfold"
import { Button } from "@/components/ui/button"
import { ago } from "@/lib/time"
import { listTrash, restoreFromTrash, useTrashChanges } from "../disk"
import { paperMeta } from "../lib/format"
import type { TrashedPaper } from "@owlit/protocol"
import { cn } from "@/lib/utils"

// The papers in the trash, asked again whenever the trash may have changed (a removal, an Undo, a restore
// from here)
function useRecentlyRemoved(): TrashedPaper[] {
  const changes = useTrashChanges((s) => s.count)
  const [removed, setRemoved] = useState<TrashedPaper[]>([])
  useEffect(() => {
    let live = true
    listTrash().then(
      (found) => live && setRemoved(found),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [changes])
  return removed
}

// A quiet way back for a paper removed by mistake once the toast's Undo has gone: one fold at the end of
// All papers while the trash holds papers removed in the last 30 days, and nothing while it holds none
export function RecentlyRemoved() {
  const removed = useRecentlyRemoved()
  const [open, setOpen] = useState(false)
  if (!removed.length) return null
  return (
    <section className="mt-6">
      {/* The fold lines its chevron up with the rows' text, as a group label does */}
      <FoldButton open={open} onClick={() => setOpen(!open)} className="ml-1">
        {removed.length === 1 ? t`A paper removed recently` : plural(removed.length, { one: "# paper removed recently", other: "# papers removed recently" })}
      </FoldButton>
      <Unfold open={open}>
        <RowList as="ul" className="mt-1">
          {removed.map((p) => (
            <RemovedRow key={p.id} paper={p} />
          ))}
        </RowList>
      </Unfold>
    </section>
  )
}

// The title, its details, and when it was removed, which gives way to Restore on hover or focus
function RemovedRow({ paper }: { paper: TrashedPaper }) {
  const [restoring, setRestoring] = useState(false)
  const restore = () => {
    setRestoring(true)
    void restoreFromTrash([paper.id]).finally(() => setRestoring(false))
  }
  const when = ago(paper.removedAt, { inSentence: true })
  return (
    <li className={cn("group/row flex h-9 items-center gap-3 text-sm hover:bg-accent", rowClass)}>
      <span className="min-w-0 flex-1 truncate" title={paper.title}>
        {paper.title}
      </span>
      <span className="max-w-[40%] shrink-0 truncate text-detail text-muted-foreground">{paperMeta(paper)}</span>
      <span className="relative flex shrink-0 items-center justify-end">
        <span className="text-detail text-muted-foreground tabular-nums group-hover/row:invisible group-has-focus-key/row:invisible">
          {t`Removed ${when}`}
        </span>
        <Button
          variant="text"
          size="inline"
          disabled={restoring}
          onClick={restore}
          className={cn("absolute -right-1.5", revealOnHover)}
        >
          {t`Restore`}
        </Button>
      </span>
    </li>
  )
}
