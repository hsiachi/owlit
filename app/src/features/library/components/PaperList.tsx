import { EllipsisVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import type { PaperGroup } from "../lib/filter"
import { formatAdded, shortAuthors } from "../lib/format"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useUiStore } from "../ui-store"
import { PaperContextContent, PaperDropdownContent } from "./PaperMenu"
import { PaperPeek } from "./PaperPeek"
import { StarButton, StarMark } from "./StarButton"
import { TagDot } from "./TagsEditor"

// Click selects and peeks, ⌘-click toggles, ⇧-click extends, double-click opens. Right-click on
// an unselected row acts on that row alone.
function useRowHandlers(paper: Paper, order: string[]) {
  const click = useUiStore((s) => s.click)
  const selected = useUiStore((s) => s.selectedIds.includes(paper.id))
  const selectedIds = useUiStore((s) => s.selectedIds)
  const actions = usePaperActions()
  return {
    selected,
    menuIds: selected ? selectedIds : [paper.id],
    handlers: {
      "data-paper-id": paper.id,
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("button")) return
        if (e.detail === 2) return actions.open(paper.id)
        click(paper.id, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "single", order)
      },
      onContextMenu: () => {
        if (!selected) useUiStore.setState({ selectedIds: [paper.id], cursorId: paper.id, anchorId: paper.id })
      },
    },
  }
}

// Star and ellipsis, shown while the row is hovered, focused or has its menu open
function RowActions({ paper, menuIds, className }: { paper: Paper; menuIds: string[]; className?: string }) {
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  return (
    <span className={cn("hidden shrink-0 items-center group-hover/row:flex group-focus-within/row:flex has-data-[state=open]:flex", className)}>
      <StarButton size="icon-xs" starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="More actions" className="text-muted-foreground hover:bg-foreground/8 data-[state=open]:bg-foreground/8">
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <PaperDropdownContent ids={menuIds} />
      </DropdownMenu>
    </span>
  )
}

function ListRow({ paper, order }: { paper: Paper; order: string[] }) {
  const { selected, menuIds, handlers } = useRowHandlers(paper, order)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...handlers}
          className={cn(
            "group/row flex h-9 cursor-default items-center gap-2 rounded-md pr-1 pl-2.5 text-sm select-none hover:bg-muted",
            selected && "bg-accent hover:bg-accent",
          )}
        >
          {/* Finished papers recede; the title keeps its width and the authors take what's left */}
          <span className={cn("min-w-0 truncate", paper.status === "read" && "text-muted-foreground")}>{paper.title}</span>
          <span className="shrink-0 text-[13px] text-muted-foreground">
            {[shortAuthors(paper.authors), paper.year].filter(Boolean).join(" · ")}
          </span>
          {paper.starred && <StarMark />}
          <span className="flex-1" />
          <RowActions paper={paper} menuIds={menuIds} />
        </div>
      </ContextMenuTrigger>
      <PaperContextContent ids={menuIds} />
    </ContextMenu>
  )
}

export function PaperList({ groups, order }: { groups: PaperGroup[]; order: string[] }) {
  const peekId = useUiStore((s) => s.peekId)
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <section key={g.label ?? i}>
          {g.label && <h2 className="mb-1 px-2.5 text-xs text-muted-foreground">{g.label}</h2>}
          {g.papers.map((p) => (p.id === peekId ? <PaperPeek key={p.id} paper={p} /> : <ListRow key={p.id} paper={p} order={order} />))}
        </section>
      ))}
    </div>
  )
}

const COLUMNS = [
  { key: "title", label: "Title", width: undefined, sort: "title" },
  { key: "authors", label: "Authors", width: "8.5rem", sort: "authors" },
  { key: "year", label: "Year", width: "4rem", sort: "year" },
  { key: "venue", label: "Venue", width: "7rem", sort: "venue" },
  { key: "tags", label: "Tags", width: "9rem" },
  { key: "status", label: "Status", width: "5rem" },
  { key: "added", label: "Added", width: "6rem", sort: "addedAt" },
] as const

function TableRow({ paper, order }: { paper: Paper; order: string[] }) {
  const { selected, menuIds, handlers } = useRowHandlers(paper, order)
  // Square cells with a hairline under each row (none under the last), as in answer tables
  const td = cn("h-9 truncate border-b px-2.5 text-[13px] text-muted-foreground group-last/row:border-b-0 group-hover/row:bg-muted", selected && "bg-accent group-hover/row:bg-accent")
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr {...handlers} className="group/row cursor-default select-none">
          <td className={cn(td, "text-sm text-foreground", paper.status === "read" && "text-muted-foreground")}>
            <span className="flex items-center gap-2">
              <span className="truncate">{paper.title}</span>
              {paper.starred && <StarMark />}
            </span>
          </td>
          <td className={td}>{shortAuthors(paper.authors)}</td>
          <td className={cn(td, "tabular-nums")}>{paper.year}</td>
          <td className={td}>{paper.venue}</td>
          <td className={td}>
            {paper.tags.length > 0 && (
              <span className="flex items-center gap-1.5">
                <TagDot tag={paper.tags[0]} className="size-1.5" />
                <span className="truncate">{paper.tags[0]}</span>
                {paper.tags.length > 1 && <span className="shrink-0">+{paper.tags.length - 1}</span>}
              </span>
            )}
          </td>
          <td className={td}>{paper.status === "unread" ? "" : paper.status === "reading" ? "Reading" : "Read"}</td>
          <td className={cn(td, "tabular-nums")}>
            {/* The date gives way to the row's actions on hover */}
            <span className="group-hover/row:hidden group-focus-within/row:hidden group-has-data-[state=open]/row:hidden">{formatAdded(paper.addedAt)}</span>
            <RowActions paper={paper} menuIds={menuIds} className="-my-1 -mr-1.5 justify-end" />
          </td>
        </tr>
      </ContextMenuTrigger>
      <PaperContextContent ids={menuIds} />
    </ContextMenu>
  )
}

// The same papers as a ruled table: a tinted header row, a hairline under each row, no grid.
// Column headers sort; clicking a row peeks in a full-width row beneath it.
export function PaperTable({ papers, order }: { papers: Paper[]; order: string[] }) {
  const peekId = useUiStore((s) => s.peekId)
  const sort = useUiStore((s) => s.sort)
  const sortBy = useUiStore((s) => s.sortBy)
  return (
    <table className="w-full table-fixed border-separate border-spacing-0">
      <colgroup>
        {COLUMNS.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map((c, i) => {
            const active = "sort" in c && sort.key === c.sort
            return (
              <th
                key={c.key}
                aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}
                className="sticky top-0 z-10 h-9 border-b-4 border-background bg-background px-2.5 text-left text-xs font-medium text-muted-foreground"
              >
                {/* The tint sits on a layer inside the cell's padding, so the sticky header stays opaque over scrolled
                    rows and a 4px band of sheet separates it from the first row's hover fill */}
                <span
                  aria-hidden
                  className={cn("absolute inset-0 -z-10 bg-muted", i === 0 && "rounded-l-md", i === COLUMNS.length - 1 && "rounded-r-md")}
                />
                {"sort" in c ? (
                  <button
                    type="button"
                    onClick={() => sortBy(c.sort)}
                    className={cn("-mx-1 rounded px-1 hover:text-foreground", active && "text-foreground")}
                  >
                    {c.label}
                    {active && <span className="ml-1">{sort.desc ? "↓" : "↑"}</span>}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {papers.map((p) =>
          p.id === peekId ? (
            <tr key={p.id}>
              <td colSpan={COLUMNS.length} className="px-1.5">
                <PaperPeek paper={p} />
              </td>
            </tr>
          ) : (
            <TableRow key={p.id} paper={p} order={order} />
          ),
        )}
      </tbody>
    </table>
  )
}
