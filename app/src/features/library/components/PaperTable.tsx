import { useEffect, useRef } from "react"
import { ArrowDownIcon, ArrowUpIcon, FileTextIcon, MoreHorizontalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { usePaperActions } from "../actions"
import { formatAdded, shortAuthors } from "../lib/format"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { type SortKey, useUiStore } from "../ui-store"
import { PaperContextContent, PaperDropdownContent } from "./PaperMenu"
import { StarButton } from "./StarButton"
import { StatusLabel } from "./StatusSelect"

const MAX_TAGS = 3

function SortableHead({
  label,
  sortKey,
  className,
}: {
  label: string
  sortKey: SortKey
  className?: string
}) {
  const sort = useUiStore((s) => s.sort)
  const sortBy = useUiStore((s) => s.sortBy)
  const active = sort.key === sortKey
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => sortBy(sortKey)}
        className={cn(
          "-ml-1.5 inline-flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-muted hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active && (sort.desc ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />)}
      </button>
    </TableHead>
  )
}

// The library table. Rows select like a file list: click, ⌘-click, ⇧-click; Enter or
// double-click opens the paper; right-click or ⋯ for actions.
export function PaperTable({ papers }: { papers: Paper[] }) {
  const selectedIds = useUiStore((s) => s.selectedIds)
  const activeId = useUiStore((s) => s.activeId)
  const select = useUiStore((s) => s.select)
  const selectAll = useUiStore((s) => s.selectAll)
  const clearSelection = useUiStore((s) => s.clearSelection)
  const scrollTop = useUiStore((s) => s.scrollTop)
  const setScrollTop = useUiStore((s) => s.setScrollTop)
  const toggleStar = useLibraryStore((s) => s.toggleStar)
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
      // Container queries: secondary columns give way as this pane narrows (e.g. when the
      // detail pane opens), so the title keeps the width it needs
      className="@container min-h-0 flex-1 overflow-auto outline-none"
      aria-label="Papers"
    >
      <Table className="table-fixed">
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10" />
            <SortableHead label="Title" sortKey="title" />
            <SortableHead label="Year" sortKey="year" className="w-16" />
            <SortableHead label="Venue" sortKey="venue" className="w-32 @max-2xl:hidden" />
            <TableHead className="w-48 @max-4xl:hidden">Tags</TableHead>
            <SortableHead label="Status" sortKey="status" className="w-28" />
            <SortableHead label="Added" sortKey="addedAt" className="w-20 @max-3xl:hidden" />
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {papers.map((paper) => {
            const selected = selectedSet.has(paper.id)
            const active = paper.id === activeId
            // Right-click on an unselected row acts on that row alone
            const menuIds = selected ? selectedIds : [paper.id]
            return (
              <ContextMenu key={paper.id}>
                <ContextMenuTrigger asChild>
                  <TableRow
                    data-paper-id={paper.id}
                    data-state={selected ? "selected" : undefined}
                    onClick={(e) => onRowClick(e, paper.id)}
                    onDoubleClick={() => actions.open(paper.id)}
                    onContextMenu={() => {
                      if (!selected) select(paper.id, "single", order)
                    }}
                    className={cn(
                      "group/row cursor-default select-none",
                      selected && "bg-muted hover:bg-muted",
                      active && "bg-accent hover:bg-accent",
                    )}
                  >
                    <TableCell className="pr-0">
                      <StarButton
                        size="icon-xs"
                        starred={paper.starred}
                        onToggle={() => toggleStar(paper.id)}
                        className={cn(!paper.starred && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100")}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{paper.title}</span>
                        {paper.pdf && <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has PDF" />}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{shortAuthors(paper.authors)}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">{paper.year ?? "—"}</TableCell>
                    <TableCell className="truncate text-muted-foreground @max-2xl:hidden">{paper.venue ?? "—"}</TableCell>
                    <TableCell className="@max-4xl:hidden">
                      <div className="flex items-center gap-1 overflow-hidden">
                        {paper.tags.slice(0, MAX_TAGS).map((t) => (
                          <Badge key={t} variant="secondary" className="shrink-0">
                            {t}
                          </Badge>
                        ))}
                        {paper.tags.length > MAX_TAGS && (
                          <span className="text-xs text-muted-foreground">+{paper.tags.length - MAX_TAGS}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusLabel status={paper.status} className="text-muted-foreground" />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums @max-3xl:hidden">{formatAdded(paper.addedAt)}</TableCell>
                    <TableCell className="pl-0">
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
                            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100 focus-visible:opacity-100"
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <PaperDropdownContent ids={menuIds} />
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                </ContextMenuTrigger>
                <PaperContextContent ids={menuIds} />
              </ContextMenu>
            )
          })}
        </TableBody>
      </Table>
      {papers.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">No papers match.</div>
      )}
    </div>
  )
}
