import { forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import { KindIcon } from "@/components/kind-icon"
import { Kbd } from "@/components/ui/kbd"
import type { Mentionable, SourceKind } from "@/features/chat/types"
import { KIND_PLACE } from "@/lib/kinds"

// What a pick hands back to the editor that opened the list
export interface MentionPick {
  id: string
  label: string
  kind: SourceKind
}

export interface MentionListHandle {
  onKeyDown: (props: { event: Pick<KeyboardEvent, "key" | "shiftKey"> }) => boolean
}

type Filter = SourceKind | "all"
const FILTERS: Filter[] = ["all", "paper", "doc", "knowledge"]
const ORDER: SourceKind[] = ["paper", "doc", "knowledge"]
const PER_GROUP_WHEN_ALL = 4

export interface MentionListProps {
  items: Mentionable[]
  command: (pick: MentionPick) => void
  initialFilter?: Filter
}

// The "@" popup, the same in the composer, a doc and a note. Its editor drives the keyboard through the
// imperative handle; Tab cycles the source filter.
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList({ items, command, initialFilter = "all" }, ref) {
  const [filter, setFilter] = useState<Filter>(initialFilter)
  const [index, setIndex] = useState(0)
  // Reset the highlight whenever the visible list changes (adjusting state during render)
  const [basis, setBasis] = useState<{ items: Mentionable[]; filter: Filter }>({ items, filter })
  if (basis.items !== items || basis.filter !== filter) {
    setBasis({ items, filter })
    setIndex(0)
  }

  const groups = useMemo(() => {
    const kinds = filter === "all" ? ORDER : [filter]
    return kinds
      .map((kind) => {
        const all = items.filter((i) => i.kind === kind)
        return { kind, items: filter === "all" ? all.slice(0, PER_GROUP_WHEN_ALL) : all, total: all.length }
      })
      .filter((g) => g.items.length > 0)
  }, [items, filter])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])

  const select = (item: Mentionable | undefined) => {
    if (item) command({ id: item.id, label: item.title, kind: item.kind })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowDown") {
        setIndex((i) => (flat.length ? (i + 1) % flat.length : 0))
        return true
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0))
        return true
      }
      if (event.key === "Tab") {
        const dir = event.shiftKey ? -1 : 1
        setFilter((f) => FILTERS[(FILTERS.indexOf(f) + dir + FILTERS.length) % FILTERS.length])
        return true
      }
      if (event.key === "Enter") {
        select(flat[index])
        return true
      }
      return false
    },
  }))

  return (
    <div className="menu-surface flex w-[26rem] flex-col overflow-hidden rounded-xl p-1 text-popover-foreground">
      <div className="flex items-center gap-1 border-b px-1 pb-1.5" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFilter(f)}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground", filter === f && "bg-muted text-foreground")}
          >
            {f === "all" ? "All" : KIND_PLACE[f]}
          </button>
        ))}
        <Kbd className="mr-0.5 ml-auto">Tab</Kbd>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {flat.length === 0 && <div className="px-3 py-2.5 text-sm text-muted-foreground">No matches</div>}
        {groups.map((g) => (
          <div key={g.kind} className="py-1">
            <div className="flex items-center px-2.5 py-2 text-xs text-muted-foreground">
              {KIND_PLACE[g.kind]}
              {g.total > g.items.length && (
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setFilter(g.kind)} className="ml-auto rounded-sm px-1 font-normal hover:text-foreground">
                  Show all {g.total}
                </button>
              )}
            </div>
            {g.items.map((item) => {
              const active = flat[index]?.id === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setIndex(flat.indexOf(item))}
                  onClick={() => select(item)}
                  className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-hidden", active && "bg-muted")}
                >
                  <KindIcon kind={item.kind} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="truncate">{item.title}</span>
                    {item.subtitle && <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
})
