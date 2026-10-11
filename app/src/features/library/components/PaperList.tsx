import { ago } from "@/lib/time"
import { MARK_CLOSE, MARK_OPEN } from "@owlit/protocol"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { EllipsisVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { usePaperActions } from "../actions"
import type { PaperGroup } from "../lib/filter"
import { shortAuthors, shortVenue } from "../lib/format"
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

// Star and ellipsis, shown while the row is hovered, focused or has its menu up. "Up" lasts until
// the menu's fade-out ends: hiding the trigger as soon as the menu closes leaves the fading menu
// anchored to nothing, and it jumps to the window's top-left corner.
function RowActions({ paper, menuIds, className }: { paper: Paper; menuIds: string[]; className?: string }) {
  const toggleStar = useLibraryStore((s) => s.toggleStar)
  const [menuUp, setMenuUp] = useState(false)
  return (
    <span
      data-menu-up={menuUp || undefined}
      className={cn("hidden shrink-0 items-center group-hover/row:flex group-focus-within/row:flex data-menu-up:flex", className)}
    >
      <StarButton size="icon-xs" starred={paper.starred} onToggle={() => toggleStar(paper.id)} />
      <DropdownMenu onOpenChange={(open) => open && setMenuUp(true)}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="More actions" className="text-muted-foreground hover:bg-foreground/8 data-[state=open]:bg-foreground/8">
            <EllipsisVerticalIcon />
          </Button>
        </DropdownMenuTrigger>
        <PaperDropdownContent ids={menuIds} onCloseAutoFocus={() => setMenuUp(false)} />
      </DropdownMenu>
    </span>
  )
}

// Where Find's words were in a paper's text: the snippet in muted text, the matched words in body text
function TextSnippet({ text, className }: { text: string; className?: string }) {
  const parts = text.split(new RegExp(`${MARK_OPEN}|${MARK_CLOSE}`))
  return (
    <span className={cn("block truncate text-xs text-muted-foreground", className)}>
      {parts.map((part, i) => (i % 2 ? <span key={i} className="text-foreground">{part}</span> : part))}
    </span>
  )
}

function ListRow({ paper, order, snippet }: { paper: Paper; order: string[]; snippet?: string }) {
  const { selected, menuIds, handlers } = useRowHandlers(paper, order)
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          {...handlers}
          className={cn(
            "group/row cursor-default rounded-md pr-1 pl-2.5 text-sm select-none hover:bg-muted",
            snippet ? "py-1.5" : "",
            selected && "bg-accent hover:bg-accent",
          )}
        >
          <div className={cn("flex items-center gap-2", snippet ? "h-6" : "h-9")}>
            {/* Finished papers recede; the star belongs to the title, and the authors take what's left */}
            <span className={cn("min-w-0 truncate", paper.status === "read" && "text-muted-foreground")}>{paper.title}</span>
            {paper.starred && <StarMark />}
            <span className="shrink-0 text-detail text-muted-foreground">
              {[shortAuthors(paper.authors), paper.year].filter(Boolean).join(" · ")}
            </span>
            <span className="flex-1" />
            <RowActions paper={paper} menuIds={menuIds} />
          </div>
          {snippet && <TextSnippet text={snippet} className="pr-9" />}
        </div>
      </ContextMenuTrigger>
      <PaperContextContent ids={menuIds} />
    </ContextMenu>
  )
}

export function PaperList({ groups, order, snippets }: { groups: PaperGroup[]; order: string[]; snippets?: ReadonlyMap<string, string> }) {
  const peekId = useUiStore((s) => s.peekId)
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <section key={g.label ?? i}>
          {g.label && <h2 className="mb-1 px-2.5 text-xs text-muted-foreground">{g.label}</h2>}
          {g.papers.map((p) => (p.id === peekId ? <PaperPeek key={p.id} paper={p} /> : <ListRow key={p.id} paper={p} order={order} snippet={snippets?.get(p.id)} />))}
        </section>
      ))}
    </div>
  )
}

const COLUMNS = [
  { key: "title", label: "Title", width: undefined, sort: "title" },
  { key: "authors", label: "Authors", width: 136, sort: "authors" },
  { key: "year", label: "Year", width: 64, sort: "year" },
  { key: "venue", label: "Venue", width: 112, sort: "venue" },
  { key: "tags", label: "Tags", width: 144 },
  { key: "status", label: "Status", width: 80 },
  { key: "added", label: "Added", width: 96, sort: "addedAt" },
] as const

type Column = (typeof COLUMNS)[number]
type ColumnKey = Column["key"]

// The title is what identifies a paper, so it never gets narrower than this. When the table
// can't fit every column, they give way least-needed first; Year and Added (which holds the
// row's actions) always stay.
const TITLE_MIN = 320
const GIVE_WAY: ColumnKey[] = ["venue", "status", "tags", "authors"]

function useColumns(table: React.RefObject<HTMLTableElement | null>): Column[] {
  // How many of GIVE_WAY are hidden. Updated inside the observer with flushSync, which runs
  // before paint, so the table never shows a frame with every column squeezed in; and it only
  // re-renders when a column actually comes or goes.
  const [hidden, setHidden] = useState(0)
  useLayoutEffect(() => {
    const el = table.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width
      let n = 0
      let fixed = COLUMNS.reduce((sum, c) => sum + (c.width ?? 0), 0)
      while (n < GIVE_WAY.length && width - fixed < TITLE_MIN) {
        fixed -= COLUMNS.find((c) => c.key === GIVE_WAY[n])?.width ?? 0
        n++
      }
      flushSync(() => setHidden(n))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [table])
  return useMemo(() => COLUMNS.filter((c) => !GIVE_WAY.slice(0, hidden).includes(c.key)), [hidden])
}

function TableRow({ paper, order, columns, snippet }: { paper: Paper; order: string[]; columns: Set<ColumnKey>; snippet?: string }) {
  const { selected, menuIds, handlers } = useRowHandlers(paper, order)
  // Square cells with a hairline under each row (none under the last), as in answer tables
  const td = cn("h-9 truncate border-b px-2.5 text-detail text-muted-foreground group-last/row:border-b-0 group-hover/row:bg-muted", selected && "bg-accent group-hover/row:bg-accent")
  const venue = paper.venue && shortVenue(paper.venue)
  // Status says "Read" in its own column; only when that column has given way does the title recede instead
  const muted = paper.status === "read" && !columns.has("status")
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr {...handlers} className="group/row cursor-default select-none">
          <td className={cn(td, "text-sm text-foreground", muted && "text-muted-foreground")}>
            <span className="flex items-center gap-2">
              <span className="truncate">{paper.title}</span>
              {paper.starred && <StarMark />}
            </span>
            {snippet && <TextSnippet text={snippet} className="max-w-xl pb-1.5" />}
          </td>
          {columns.has("authors") && <td className={td}>{shortAuthors(paper.authors)}</td>}
          <td className={cn(td, "tabular-nums")}>{paper.year}</td>
          {columns.has("venue") && (
            <td className={td} title={venue !== paper.venue ? paper.venue : undefined}>
              {venue}
            </td>
          )}
          {columns.has("tags") && (
            <td className={td}>
              {paper.tags.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <TagDot tag={paper.tags[0]} className="size-1.5" />
                  <span className="truncate">{paper.tags[0]}</span>
                  {paper.tags.length > 1 && <span className="shrink-0">+{paper.tags.length - 1}</span>}
                </span>
              )}
            </td>
          )}
          {columns.has("status") && <td className={td}>{paper.status === "unread" ? "" : paper.status === "reading" ? "Reading" : "Read"}</td>}
          <td className={cn(td, "tabular-nums")}>
            {/* The date gives way to the row's actions on hover */}
            <span className="group-hover/row:hidden group-focus-within/row:hidden group-has-data-menu-up/row:hidden">{ago(paper.addedAt)}</span>
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
export function PaperTable({ papers, order, snippets }: { papers: Paper[]; order: string[]; snippets?: ReadonlyMap<string, string> }) {
  const peekId = useUiStore((s) => s.peekId)
  const sort = useUiStore((s) => s.sort)
  const sortBy = useUiStore((s) => s.sortBy)
  const table = useRef<HTMLTableElement>(null)
  const columns = useColumns(table)
  const shown = useMemo(() => new Set(columns.map((c) => c.key)), [columns])
  return (
    <table ref={table} className="w-full table-fixed border-separate border-spacing-0">
      <colgroup>
        {columns.map((c) => (
          <col key={c.key} style={{ width: c.width }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((c, i) => {
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
                  className={cn("absolute inset-0 -z-10 bg-muted", i === 0 && "rounded-l-md", i === columns.length - 1 && "rounded-r-md")}
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
              <td colSpan={columns.length} className="px-1.5">
                <PaperPeek paper={p} />
              </td>
            </tr>
          ) : (
            <TableRow key={p.id} paper={p} order={order} columns={shown} snippet={snippets?.get(p.id)} />
          ),
        )}
      </tbody>
    </table>
  )
}
