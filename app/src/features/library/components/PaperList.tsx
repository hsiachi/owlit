import { ago } from "@/lib/time"
import { MARK_CLOSE, MARK_OPEN } from "@owlit/protocol"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, RowMenuButton } from "@/components/action-menu"
import { GroupLabel } from "@/components/group-label"
import { NoteDot } from "@/components/marks"
import { Unfold } from "@/components/unfold"
import { useDigestState, type DigestState } from "../digests"
import type { PaperGroup } from "../lib/filter"
import { paperMeta, shortAuthors, shortVenue } from "../lib/format"
import { STATUS_LABEL } from "../lib/status"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"
import { PaperRowMenu } from "./PaperMenu"
import { PaperPeek } from "./PaperPeek"
import { PaperRow } from "./PaperRow"
import { StarButton, StarMark } from "./StarButton"
import { TagDot } from "./TagsEditor"

// Click selects and peeks, ⌘-click toggles, ⇧-click extends, double-click opens. A row reads only whether
// it is selected, so selecting one re-renders two rows, not the list.
function useRowHandlers(paper: Paper, order: string[], open: (id: string) => void) {
  const selected = useLibraryUi((s) => s.selectedIds.includes(paper.id))
  return {
    selected,
    handlers: {
      "data-paper-id": paper.id,
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest("button")) return
        if (e.detail === 2) return open(paper.id)
        useLibraryUi.getState().click(paper.id, e.shiftKey ? "range" : e.metaKey || e.ctrlKey ? "toggle" : "single", order)
      },
    },
  }
}

// The menu's items are built only while it is open (PaperRowMenu), so closed rows run none of its hooks
function RowMenu({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <ActionsOnRightClick menu={<PaperRowMenu id={id} />} onOpen={() => useLibraryUi.getState().selectForMenu(id)} className="w-48">
      {children}
    </ActionsOnRightClick>
  )
}

// Star and ellipsis, shown while the row is hovered, holds keyboard focus or has its menu up (the table's
// last cell, where the date gives way to them)
function RowActions({ paper, className }: { paper: Paper; className?: string }) {
  return (
    <span className={cn("hidden shrink-0 items-center group-hover/row:flex group-has-focus-key/row:flex group-has-data-menu-up/row:flex", className)}>
      <StarButton size="icon-xs" starred={paper.starred} onToggle={() => useLibraryStore.getState().setStarred([paper.id], !paper.starred)} />
      <RowMenuButton menu={<PaperRowMenu id={paper.id} />} label="More actions" menuClassName="w-48" />
    </span>
  )
}

// The list row's end slot: the ellipsis, then the star at the far end, where a starred paper's star stays
// so the stars of a list line up. Both hold their place while hidden, so the details never shift.
const ON_HOVER = "invisible group-hover/row:visible group-has-focus-key/row:visible group-has-data-menu-up/row:visible"

function RowSlot({ paper }: { paper: Paper }) {
  return (
    <span className="flex shrink-0 items-center">
      <RowMenuButton menu={<PaperRowMenu id={paper.id} />} label="More actions" menuClassName="w-48" className={cn("flex", ON_HOVER, "data-menu-up:visible")} />
      <StarButton
        size="icon-xs"
        starred={paper.starred}
        onToggle={() => useLibraryStore.getState().setStarred([paper.id], !paper.starred)}
        className={paper.starred ? undefined : ON_HOVER}
      />
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

// Where the paper's digest stands, on the ladder of states: breathing while Owlit writes it, Owlit's dot
// once it is new since the user looked, red when the run broke (the row says so in words too)
function DigestMark({ state }: { state: DigestState }) {
  if (state === "writing")
    return (
      <span role="img" aria-label="Writing the digest" title="Writing the digest" className="size-2 shrink-0 animate-ring-breathe rounded-full bg-muted-foreground motion-reduce:animate-none" />
    )
  if (state === "new") return <NoteDot label="New digest" />
  if (state === "failed") return <span role="img" aria-label="Digest stopped" title="Digest stopped" className="size-2 shrink-0 rounded-full bg-destructive" />
  return null
}

// The slot before a title in the list, as in the chat list: empty for an unread paper, a half-filled ring
// while it is being read, the digest's mark while it has one. Every row has the slot, so titles start at
// one place and the ring comes or goes without moving the row.
function PaperStatusMark({ paper, digest }: { paper: Paper; digest: DigestState }) {
  const label = paper.status === "reading" ? "Reading" : undefined
  if (digest) {
    return (
      <span className="grid size-4 shrink-0 place-items-center">
        <DigestMark state={digest} />
      </span>
    )
  }
  return (
    <span className="grid size-4 shrink-0 place-items-center" title={label}>
      {paper.status === "reading" && (
        <span className="size-2 rounded-full border-[1.5px] border-muted-foreground bg-[linear-gradient(90deg,var(--muted-foreground)_50%,transparent_50%)]" />
      )}
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

function ListRow({ paper, order, open, snippet }: { paper: Paper; order: string[]; open: (id: string) => void; snippet?: string }) {
  const { selected, handlers } = useRowHandlers(paper, order, open)
  const digest = useDigestState(paper)
  return (
    <RowMenu id={paper.id}>
      <PaperRow
        {...handlers}
        className={cn(selected && "bg-accent hover:bg-accent")}
        mark={<PaperStatusMark paper={paper} digest={digest} />}
        title={paper.title}
        // A publisher waiting on the user, or a digest that stopped, says so in words, first among the
        // row's details
        meta={[paper.noPdf?.needs && "Needs you", digest === "failed" && "Digest stopped", paperMeta(paper)].filter(Boolean).join(" · ")}
        slot={<RowSlot paper={paper} />}
        below={snippet && <TextSnippet text={snippet} className="pr-14 pl-7" />}
      />
    </RowMenu>
  )
}

// A paper in the list: its row, and the peek that opens in its place. The row folds as the peek unfolds, so
// the rows below move down over the one change and the eye keeps its place; the peek's card overhangs the
// row by 6px a side, so the fold's clip box is widened by as much.
function ListItem({ paper, peeked, ...rest }: { paper: Paper; peeked: boolean; order: string[]; open: (id: string) => void; snippet?: string }) {
  return (
    <div>
      <Unfold open={!peeked} keepMounted>
        <ListRow paper={paper} {...rest} />
      </Unfold>
      <Unfold open={peeked} innerClassName="-mx-1.5 px-1.5">
        <PaperPeek paper={paper} />
      </Unfold>
    </div>
  )
}

export function PaperList({ groups, order, snippets }: { groups: PaperGroup[]; order: string[]; snippets?: ReadonlyMap<string, string> }) {
  const peekId = useLibraryUi((s) => s.peekId)
  const navigate = useNavigate()
  const open = (id: string) => navigate(`/library/${id}`)
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <section key={g.label ?? i}>
          {g.label && <GroupLabel>{g.label}</GroupLabel>}
          {g.papers.map((p) => (
            <ListItem key={p.id} paper={p} peeked={p.id === peekId} order={order} open={open} snippet={snippets?.get(p.id)} />
          ))}
        </section>
      ))}
    </div>
  )
}

const COLUMNS = [
  { key: "title", label: "Title", width: undefined, sort: "title" },
  { key: "authors", label: "Authors", width: 136, sort: "authors" },
  { key: "year", label: "Year", width: 64, sort: "year" },
  { key: "venue", label: "Venue", width: 160, sort: "venue" },
  { key: "tags", label: "Tags", width: 144 },
  { key: "status", label: "Status", width: 104 },
  { key: "added", label: "Added", width: 96, sort: "addedAt" },
] as const

type Column = (typeof COLUMNS)[number]
type ColumnKey = Column["key"]

// The title is what identifies a paper, so it never gets narrower than this. When the table
// can't fit every column, they give way least-needed first; Year and Added (which holds the
// row's actions) always stay.
const TITLE_MIN = 320
const GIVE_WAY: ColumnKey[] = ["venue", "status", "tags", "authors"]

// Columns no paper in view fills (no tags yet, every paper unread) are left out rather than shown blank
const FILLED: Partial<Record<ColumnKey, (p: Paper) => boolean>> = {
  venue: (p) => !!p.venue,
  tags: (p) => p.tags.length > 0,
  status: (p) => p.status !== "unread" || !!p.noPdf?.needs,
}

function useColumns(table: React.RefObject<HTMLTableElement | null>, papers: Paper[]): Column[] {
  const kept = useMemo(
    () => COLUMNS.filter((c) => !FILLED[c.key] || papers.some(FILLED[c.key]!)),
    [papers],
  )
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
      let fixed = kept.reduce((sum, c) => sum + (c.width ?? 0), 0)
      while (n < GIVE_WAY.length && width - fixed < TITLE_MIN) {
        fixed -= kept.find((c) => c.key === GIVE_WAY[n])?.width ?? 0
        n++
      }
      flushSync(() => setHidden(n))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [table, kept])
  return useMemo(() => kept.filter((c) => !GIVE_WAY.slice(0, hidden).includes(c.key)), [kept, hidden])
}

function TableRow({ paper, order, open, columns, snippet }: { paper: Paper; order: string[]; open: (id: string) => void; columns: Set<ColumnKey>; snippet?: string }) {
  const { selected, handlers } = useRowHandlers(paper, order, open)
  const digest = useDigestState(paper)
  // Square cells with a hairline under each row (none under the last), as in answer tables
  const td = cn("h-9 truncate border-b px-2.5 text-detail text-muted-foreground group-last/row:border-b-0 group-hover/row:bg-muted", selected && "bg-accent group-hover/row:bg-accent")
  const venue = paper.venue && shortVenue(paper.venue)
  // Status says "Read" in its own column; only when that column has given way does the title recede instead
  const muted = paper.status === "read" && !columns.has("status")
  return (
    <RowMenu id={paper.id}>
      <tr {...handlers} className="group/row cursor-default select-none">
        <td className={cn(td, "text-sm text-foreground", muted && "text-muted-foreground")}>
          <span className="flex items-center gap-2">
            <span className="truncate">{paper.title}</span>
            {/* The table has no status slot: the digest's mark follows the title, as the star does */}
            <DigestMark state={digest} />
            {paper.starred && <StarMark />}
          </span>
          {snippet && <TextSnippet text={snippet} className="max-w-xl pb-1.5" />}
        </td>
        {columns.has("authors") && <td className={td}>{shortAuthors(paper.authors)}</td>}
        <td className={cn(td, "tabular-nums")}>{paper.year}</td>
        {columns.has("venue") && (
          <td className={td} title={paper.venue}>
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
        {/* Unread is the default, so it says nothing */}
        {columns.has("status") && (
          <td className={td}>
            {/* A publisher waiting on the user says so before the reading status, as the list row does */}
            {paper.noPdf?.needs ? (
              "Needs you"
            ) : digest === "failed" ? (
              "Digest stopped"
            ) : paper.status === "unread" ? (
              ""
            ) : (
              STATUS_LABEL[paper.status]
            )}
          </td>
        )}
        <td className={cn(td, "tabular-nums")}>
          {/* The date gives way to the row's actions */}
          <span className="group-hover/row:hidden group-has-focus-key/row:hidden group-has-data-menu-up/row:hidden">{ago(paper.addedAt)}</span>
          <RowActions paper={paper} className="-my-1 -mr-1.5 justify-end" />
        </td>
      </tr>
    </RowMenu>
  )
}

// The same papers as a ruled table: a tinted header row, a hairline under each row, no grid.
// Column headers sort; clicking a row peeks in a full-width row beneath it.
export function PaperTable({ papers, order, snippets }: { papers: Paper[]; order: string[]; snippets?: ReadonlyMap<string, string> }) {
  const peekId = useLibraryUi((s) => s.peekId)
  const sort = useLibraryUi((s) => s.sort)
  const sortBy = useLibraryUi((s) => s.sortBy)
  const navigate = useNavigate()
  const open = (id: string) => navigate(`/library/${id}`)
  const table = useRef<HTMLTableElement>(null)
  const columns = useColumns(table, papers)
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
                {/* A table row can't fold, so the peek unfolds where the row was, and the row comes back at once */}
                <Unfold open appear innerClassName="-mx-1.5 px-1.5">
                  <PaperPeek paper={p} />
                </Unfold>
              </td>
            </tr>
          ) : (
            <TableRow key={p.id} paper={p} order={order} open={open} columns={shown} snippet={snippets?.get(p.id)} />
          ),
        )}
      </tbody>
    </table>
  )
}
