import { forwardRef, useImperativeHandle, useMemo, useState } from "react"
import { cn } from "cn"
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion"
import type { Mentionable, SourceKind } from "../../types"
import { SourceIcon, sourceKindLabel } from "../source-icons"
import type { MentionAttrs } from "./mention-extension"

export interface MentionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

type Filter = SourceKind | "all"
const FILTERS: Filter[] = ["all", "paper", "doc", "knowledge"]
const ORDER: SourceKind[] = ["paper", "doc", "knowledge"]
const PER_GROUP_WHEN_ALL = 4

export interface MentionListProps extends SuggestionProps<Mentionable, MentionAttrs> {
  initialFilter?: Filter
}

// Popup shown while typing after "@". Keyboard is driven by the suggestion plugin
// through the imperative handle; Tab cycles the source filter.
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(function MentionList(
  { items, command, initialFilter = "all" },
  ref,
) {
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
    <div className="flex w-80 flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10">
      <div className="flex items-center gap-1 border-b px-1 pb-1" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              filter === f && "bg-muted text-foreground",
            )}
          >
            {f === "all" ? "All" : sourceKindLabel[f]}
          </button>
        ))}
        <kbd className="ml-auto mr-1 text-[10px] text-muted-foreground">Tab</kbd>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {flat.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No matches</div>}
        {groups.map((g) => (
          <div key={g.kind} className="p-1">
            <div className="flex items-center px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {sourceKindLabel[g.kind]}
              {g.total > g.items.length && <span className="ml-auto">{g.total} total</span>}
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
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden",
                    active && "bg-muted",
                  )}
                >
                  <SourceIcon kind={item.kind} className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.title}</span>
                    {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
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
