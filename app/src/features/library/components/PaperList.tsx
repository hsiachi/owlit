import { useEffect, useRef } from "react"
import { MoreHorizontalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import { formatAdded, paperMeta } from "../lib/format"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useUiStore } from "../ui-store"
import { PaperContextContent, PaperDropdownContent } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { StatusDot } from "./StatusSelect"

const MAX_TAGS = 2

// The library list. Rows select like a file list: click, ⌘-click, ⇧-click; Enter or
// double-click opens the paper; right-click or ⋯ for actions.
export function PaperList({ papers }: { papers: Paper[] }) {
  const selectedIds = useUiStore((s) => s.selectedIds)
  const activeId = useUiStore((s) => s.activeId)
  const select = useUiStore((s) => s.select)
  const selectAll = useUiStore((s) => s.selectAll)
  const clearSelection = useUiStore((s) => s.clearSelection)
  const scrollTop = useUiStore((s) => s.scrollTop)
  const setScrollTop = useUiStore((s) => s.setScrollTop)
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const setStatus = useLibraryStore((s) => s.setStatus)
  const actions = usePaperActions()

  const order = papers.map((p) => p.id)
  const selectedSet = new Set(selectedIds)
  const scroller = useRef<HTMLDivElement>(null)

  // Restore the scroll position left when a paper was opened, and remember it on the way out
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    el.scrollTop = scrollTop
    return () => setScrollTop(el.scrollTop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the keyboard cursor in view
  useEffect(() => {
    if (!activeId) return
    scroller.current
      ?.querySelector<HTMLElement>(`[data-paper-id="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeId])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return
    const idx = activeId ? order.indexOf(activeId) : -1
    const mod = e.metaKey || e.ctrlKey
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault()
        if (order.length === 0) return
        const next = e.key === "ArrowDown" ? Math.min(idx + 1, order.length - 1) : Math.max(idx - 1, 0)
        select(order[next], e.shiftKey ? "range" : "single", order)
        return
      }
      case "Enter":
        if (activeId) actions.open(activeId)
        return
      case "s":
      case "S":
        if (mod || e.altKey) return
        if (selectedIds.length > 0) {
          const papersById = useLibraryStore.getState().papers
          const all = selectedIds.every((id) => papersById[id]?.starred)
          actions.setStarred(selectedIds, !all)
        }
        return
      case "Backspace":
      case "Delete":
        if (selectedIds.length > 0) actions.remove(selectedIds)
        return
      case "Escape":
        clearSelection()
        return
      case "a":
        if (mod) {
          e.preventDefault()
          selectAll(order)
        }
        return
    }
  }

  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey) select(id, "range", order)
    else if (e.metaKey || e.ctrlKey) select(id, "toggle", order)
    else select(id, "single", order)
  }

  return (
    <div
      ref={scroller}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-y-auto outline-none"
      aria-label="Papers"
    >
      <div className="mx-auto w-full max-w-4xl px-6 pb-10">
        {papers.map((paper) => {
          const selected = selectedSet.has(paper.id)
          const active = paper.id === activeId
          // Right-click on an unselected row acts on that row alone
          const menuIds = selected ? selectedIds : [paper.id]
          const hiddenTags = paper.tags.length - MAX_TAGS
          return (
            <ContextMenu key={paper.id}>
              <ContextMenuTrigger asChild>
                <div
                  data-paper-id={paper.id}
                  onClick={(e) => onRowClick(e, paper.id)}
                  onDoubleClick={() => actions.open(paper.id)}
                  onContextMenu={() => {
                    if (!selected) select(paper.id, "single", order)
                  }}
                  className={cn(
                    "group/row flex h-10 cursor-default items-center gap-2 rounded-md pr-1 pl-1.5 text-sm select-none transition-colors hover:bg-muted/70",
                    selected && "bg-foreground/5 hover:bg-foreground/5",
                    active && "bg-foreground/8 hover:bg-foreground/8",
                  )}
                >
                  <StarButton
                    size="icon-xs"
                    starred={paper.starred}
                    onToggle={() => toggleStar(paper.id)}
                    className={cn(!paper.starred && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}
                  />
                  {/* The title keeps its width; the citation line takes what's left */}
                  <span className="flex min-w-0 flex-1 items-baseline gap-2.5">
                    <span className="max-w-[72%] shrink-0 truncate">{paper.title}</span>
                    <span className="min-w-0 truncate text-[13px] text-muted-foreground">{paperMeta(paper)}</span>
                  </span>
                  {paper.tags.length > 0 && (
                    <span className="hidden shrink-0 items-center gap-1 @2xl:flex">
                      {paper.tags.slice(0, MAX_TAGS).map((t) => (
                        <span key={t} className="rounded-md bg-muted px-1.5 py-px text-[11px] leading-4 text-muted-foreground">
                          {t}
                        </span>
                      ))}
                      {hiddenTags > 0 && <span className="text-[11px] text-muted-foreground">+{hiddenTags}</span>}
                    </span>
                  )}
                  <StatusDot value={paper.status} onChange={(s) => setStatus([paper.id], s)} />
                  <span className="hidden w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums @3xl:inline">
                    {formatAdded(paper.addedAt)}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Actions"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!selected) select(paper.id, "single", order)
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100"
                      >
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <PaperDropdownContent ids={menuIds} />
                  </DropdownMenu>
                </div>
              </ContextMenuTrigger>
              <PaperContextContent ids={menuIds} />
            </ContextMenu>
          )
        })}
        {papers.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">No papers match.</p>}
      </div>
    </div>
  )
}
