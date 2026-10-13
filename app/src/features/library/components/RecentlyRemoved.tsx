import { plural, t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { BorderedList } from "@/components/bordered-list"
import { FoldButton } from "@/components/fold"
import { Unfold } from "@/components/unfold"
import { Button } from "@/components/ui/button"
import { ago } from "@/lib/time"
import { listTrash, restoreFromTrash } from "../disk"
import { paperMeta } from "../lib/format"
import { useLibraryStore } from "../store"
import type { TrashedPaper } from "@owlit/protocol"

// The papers in the trash, asked again whenever the library gains or loses a paper (a removal, an Undo,
// a restore from here)
function useRecentlyRemoved(): TrashedPaper[] {
  const ids = useLibraryStore((s) => Object.keys(s.papers).sort().join("\n"))
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
  }, [ids])
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
        <BorderedList as="ul" className="mt-1">
          {removed.map((p) => (
            <RemovedRow key={p.id} paper={p} />
          ))}
        </BorderedList>
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
    <li className="group/removed flex h-9 items-center gap-3 pr-2.5 pl-2.5 text-sm">
      <span className="min-w-0 flex-1 truncate" title={paper.title}>
        {paper.title}
      </span>
      <span className="max-w-[40%] shrink-0 truncate text-detail text-muted-foreground">{paperMeta(paper)}</span>
      <span className="relative flex shrink-0 items-center justify-end">
        <span className="text-detail text-muted-foreground tabular-nums group-hover/removed:invisible group-has-focus-key/removed:invisible">
          {t`Removed ${when}`}
        </span>
        <Button
          variant="text"
          size="inline"
          disabled={restoring}
          onClick={restore}
          className="absolute -right-1.5 opacity-0 group-hover/removed:opacity-100 focus-key:opacity-100"
        >
          {t`Restore`}
        </Button>
      </span>
    </li>
  )
}
