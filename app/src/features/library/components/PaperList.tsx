import { msg, t } from "@lingui/core/macro"
import { ago } from "@/lib/time"
import { i18n } from "@/lib/i18n"
import { MARK_CLOSE, MARK_OPEN } from "@owlit/protocol"
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, RowMenuButton } from "@/components/action-menu"
import { GroupLabel } from "@/components/group-label"
import { NoteDot, ReadingRing, StoppedDot } from "@/components/marks"
import { HeadCell, TablePeekRow, tablePeekCard } from "@/components/ruled-table"
import { Unfold } from "@/components/unfold"
import { useDigestState, type DigestState } from "../digests"
import { noPdfReason, type PaperGroup } from "../lib/filter"
import { citationsShort, citationsSource, citationsText, paperMeta, shortAuthors, shortVenue } from "../lib/format"
import { statusLabel } from "../lib/status"
import { tagsFirst } from "../lib/tags"
import { useLibraryStore } from "../store"
import type { Paper } from "../types"
import { useLibraryUi } from "../ui-store"
import { PaperRowMenu } from "./PaperMenu"
import { PaperPeek } from "./PaperPeek"
import { PaperRow } from "./PaperRow"
import { RunMark } from "@/features/runs/components"

// The run that writes a paper's reading note
const DIGEST_RUN = ["paper.digest"]
import { StarButton, StarMark } from "./StarButton"
import { TagDot } from "./TagsEditor"

// What a click on a row does is the list's (lib/use-list-keys.ts), found by the row's data-paper-id. A row
// reads only whether it is selected, so selecting one re-renders two rows, not the list.
const useSelected = (id: string) => useLibraryUi((s) => s.selectedIds.includes(id))

// The menu's items are built only while it is open (PaperRowMenu), so closed rows run none of its hooks
function RowMenu({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <ActionsOnRightClick menu={<PaperRowMenu id={id} />} onOpen={() => useLibraryUi.getState().selectForMenu(id)} className="w-48">
      {children}
    </ActionsOnRightClick>
  )
}

// A row's star and its ellipsis, in the list's end slot and the table's last cell alike
function RowStar({ paper, className }: { paper: Paper; className?: string }) {
  return <StarButton size="icon-xs" starred={paper.starred} onToggle={() => useLibraryStore.getState().setStarred([paper.id], !paper.starred)} className={className} />
}

function RowMore({ id, className }: { id: string; className?: string }) {
  return <RowMenuButton menu={<PaperRowMenu id={id} />} label={t`More actions`} menuClassName="w-48" className={className} />
}

// Star and ellipsis, shown while the row is hovered, holds keyboard focus or has its menu up (the table's
// last cell, where the date gives way to them)
function RowActions({ paper, className }: { paper: Paper; className?: string }) {
  return (
    <span className={cn("hidden shrink-0 items-center group-hover/row:flex group-has-focus-key/row:flex group-has-data-menu-up/row:flex", className)}>
      <RowStar paper={paper} />
      <RowMore id={paper.id} />
    </span>
  )
}

// The list row's end slot: the ellipsis, then the star at the far end, where a starred paper's star stays
// so the stars of a list line up. Both hold their place while hidden, so the details never shift.
// On an open card they show while the pointer is anywhere on it, so the card reads as one surface.
const ON_HOVER = "invisible group-hover/row:visible group-has-focus-key/row:visible group-has-data-menu-up/row:visible"
const ON_CARD_HOVER = "group-hover/card:visible"

function RowSlot({ paper, open }: { paper: Paper; open: boolean }) {
  const onHover = cn(ON_HOVER, open && ON_CARD_HOVER)
  return (
    <span className="flex shrink-0 items-center">
      <RowMore id={paper.id} className={cn("flex", onHover, "data-menu-up:visible")} />
      <RowStar paper={paper} className={paper.starred ? undefined : onHover} />
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
function DigestMark({ state, paperId }: { state: DigestState; paperId: string }) {
  if (state === "writing") return <RunMark subject={paperId} kinds={DIGEST_RUN} />
  if (state === "new") return <NoteDot label={t`New digest`} />
  if (state === "failed") return <StoppedDot label={t`Digest stopped`} />
  return null
}

// A paper without its PDF says why in its row: Needs you while a publisher waits on the user; otherwise
// what happened (turned away, nothing came, nothing found), a plain detail, since nothing waits on them
function noPdfWord(p: Paper) {
  switch (noPdfReason(p)) {
    case "needs":
      return t({ message: "Needs you", comment: "a paper whose publisher wants the user to check or sign in" })
    case "no-access":
      return t({ message: "No access", comment: "the user's library doesn't give them this paper" })
    case "missing":
      return t({ message: "No PDF there", comment: "the publisher has no PDF of the paper" })
    case "missed":
      return t({ message: "Didn't come", comment: "the user's browser was sent for the PDF and none arrived" })
    case "not-found":
      return t({ message: "No PDF", comment: "owlit looked for the paper's PDF and found none" })
  }
  return undefined
}

// The slot before a title in the list, as in the chat list: empty for an unread paper, a half-filled ring
// while it is being read, the digest's mark while it has one. Every row has the slot, so titles start at
// one place and the ring comes or goes without moving the row.
function PaperStatusMark({ paper, digest }: { paper: Paper; digest: DigestState }) {
  const label = paper.status === "reading" ? statusLabel("reading") : undefined
  if (digest) {
    return (
      <span className="grid size-4 shrink-0 place-items-center">
        <DigestMark state={digest} paperId={paper.id} />
      </span>
    )
  }
  return (
    <span className="grid size-4 shrink-0 place-items-center" title={label}>
      {paper.status === "reading" && <ReadingRing />}
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}

// A paper in the list, and the card it opens into in place. Closed, the card's shell is invisible: it
// overhangs the row by 6px a side, its border and padding taking those 6px, so the row sits where every row
// does. Open, the shell is the card (a peek's material, 6px of sheet above and below), the row its first
// line, and the details unfold under it, so the paper clicked stays under the pointer and a second click
// lands on it again. The card's padding is a peek's: the row's own 8px and 10px plus the shell's.
// Memoized, as the table's rows are: a change to one paper redraws its row, not the list.
const ListItem = memo(function ListItem({ paper, peeked, snippet }: { paper: Paper; peeked: boolean; snippet?: string }) {
  const selected = useSelected(paper.id)
  const digest = useDigestState(paper)
  return (
    <div
      className={cn(
        "group/card -mx-1.5 rounded-xl border border-transparent px-[5px] transition-[background-color,border-color,box-shadow,margin,padding] duration-(--t-layout) ease-(--ease) motion-reduce:transition-none",
        peeked && "my-1.5 border-border bg-card py-1.5 shadow-sm",
      )}
    >
      <RowMenu id={paper.id}>
        <PaperRow
          data-paper-id={paper.id}
          open={peeked}
          className={cn(selected && !peeked && "bg-accent hover:bg-accent")}
          mark={<PaperStatusMark paper={paper} digest={digest} />}
          title={paper.title}
          // A publisher waiting on the user (or one that turned them away), or a digest that stopped, says
          // so in words, first among the row's details
          meta={[noPdfWord(paper), digest === "failed" && t`Digest stopped`, paperMeta(paper)].filter(Boolean).join(" · ")}
          slot={<RowSlot paper={paper} open={peeked} />}
          below={snippet && <TextSnippet text={snippet} className={cn("pr-14", peeked ? "pb-1.5" : "pl-7")} />}
        />
      </RowMenu>
      <Unfold open={peeked}>
        <PaperPeek paper={paper} className="px-2.5 pb-1.5" />
      </Unfold>
    </div>
  )
})

export function PaperList({ groups, snippets }: { groups: PaperGroup[]; snippets?: ReadonlyMap<string, string> }) {
  const peekId = useLibraryUi((s) => s.peekId)
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <section key={g.label ?? i}>
          {g.label && <GroupLabel>{g.label}</GroupLabel>}
          {g.papers.map((p) => (
            <ListItem key={p.id} paper={p} peeked={p.id === peekId} snippet={snippets?.get(p.id)} />
          ))}
        </section>
      ))}
    </div>
  )
}

// Labels are said where shown (i18n._), so they follow the interface language
const COLUMNS = [
  { key: "title", label: msg`Title`, width: undefined, sort: "title" },
  { key: "authors", label: msg`Authors`, width: 136, sort: "authors" },
  { key: "year", label: msg`Year`, width: 64, sort: "year" },
  { key: "venue", label: msg`Venue`, width: 160, sort: "venue" },
  { key: "citations", label: msg({ message: "Citations", comment: "how often a paper is cited by other works" }), width: 88, sort: "citations" },
  { key: "thread", label: msg({ message: "Thread", comment: "table column: the thread a paper came from" }), width: 160, sort: "thread" },
  { key: "tags", label: msg`Tags`, width: 144 },
  { key: "status", label: msg`Status`, width: 104 },
  { key: "added", label: msg({ message: "Added", context: "when the paper was added to the library" }), width: 96, sort: "addedAt" },
] as const

type Column = (typeof COLUMNS)[number]
type ColumnKey = Column["key"]

// The title is what identifies a paper, so it never gets narrower than this. When the table
// can't fit every column, they give way least-needed first; Year and Added (which holds the
// row's actions) always stay.
const TITLE_MIN = 320
const GIVE_WAY: ColumnKey[] = ["citations", "venue", "thread", "status", "tags", "authors"]

// The threads that hold each paper, most recently changed first
type ByThread = ReadonlyMap<string, { id: string; title: string }[]>

// Columns no paper in view fills (no tags yet, every paper unread) are left out rather than shown blank
const FILLED: Partial<Record<ColumnKey, (p: Paper) => boolean>> = {
  venue: (p) => !!p.venue,
  citations: (p) => !!p.citations,
  tags: (p) => p.tags.length > 0,
  status: (p) => p.status !== "unread" || !!noPdfWord(p),
}

// Added says "Oct 8 · Owlit" for a paper Owlit added, which needs a wider cell than a date alone
const ADDED_BY_OWLIT_WIDTH = 136

function useColumns(table: React.RefObject<HTMLTableElement | null>, papers: Paper[], byThread: ByThread | undefined): Column[] {
  const kept = useMemo(() => {
    const byOwlit = papers.some((p) => p.addedBy === "agent")
    const filled = { ...FILLED, thread: (p: Paper) => !!byThread?.get(p.id)?.length }
    return COLUMNS.filter((c) => !filled[c.key] || papers.some(filled[c.key]!)).map((c) =>
      c.key === "added" && byOwlit ? { ...c, width: ADDED_BY_OWLIT_WIDTH } : c,
    ) as Column[]
  }, [papers, byThread])
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

type TableRowProps = { paper: Paper; peeked: boolean; last: boolean; columns: Set<ColumnKey>; snippet?: string; tagFilter: string[]; holding?: { id: string; title: string }[] }

// The threads holding a paper come fresh from every library change, so they are compared by what they say
const sameHolding = (a: TableRowProps["holding"], b: TableRowProps["holding"]) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((c, i) => c.id === b[i]!.id && c.title === b[i]!.title))

const TableRow = memo(TableRowView, (a, b) => {
  for (const key of Object.keys(a) as (keyof TableRowProps)[]) if (key !== "holding" && !Object.is(a[key], b[key])) return false
  return Object.keys(a).length === Object.keys(b).length && sameHolding(a.holding, b.holding)
})

function TableRowView({ paper, peeked, last, columns, snippet, tagFilter, holding }: TableRowProps) {
  const selected = useSelected(paper.id)
  const digest = useDigestState(paper)
  const tags = tagsFirst(paper.tags, tagFilter)
  // Square cells with a hairline under each row (none under the last, nor over an open card), as in answer
  // tables. Cells hold their text at the top, so an open row's wrapped title keeps its first line in place.
  const td = cn(
    "h-9 truncate border-b px-2.5 py-2 align-top text-detail leading-5 text-muted-foreground group-hover/row:bg-muted",
    (last || peeked) && "border-b-transparent",
    selected && "bg-accent group-hover/row:bg-accent",
  )
  const venue = paper.venue && shortVenue(paper.venue)
  // Status says "Read" in its own column; only when that column has given way does the title recede instead
  const muted = paper.status === "read" && !columns.has("status")
  return (
    <RowMenu id={paper.id}>
      <tr data-paper-id={paper.id} className="group/row cursor-default select-none">
        <td className={cn(td, "text-sm text-foreground", muted && "text-muted-foreground", peeked && "whitespace-normal")}>
          <span className="flex items-start gap-2">
            {/* Open, the row is its card's title line: the whole title, which underlines on hover since a click
                on it now opens the paper (as the list's open row does) */}
            <span className={cn(peeked ? "font-medium text-balance decoration-foreground/30 underline-offset-3 group-hover/row:underline" : "truncate")}>{paper.title}</span>
            {/* The table has no status slot: the digest's mark follows the title, as the star does */}
            <span className="flex h-5 shrink-0 items-center gap-2">
              <DigestMark state={digest} paperId={paper.id} />
              {paper.starred && <StarMark />}
            </span>
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
        {columns.has("citations") && (
          <td className={cn(td, "tabular-nums")} title={paper.citations && `${citationsText(paper.citations.count)} · ${citationsSource(paper.citations)}`}>
            {paper.citations && citationsShort(paper.citations.count)}
          </td>
        )}
        {columns.has("thread") && (
          <td className={td} title={holding && holding.length > 1 ? holding.map((c) => c.title).join("\n") : holding?.[0]?.title}>
            {holding?.length ? (
              <span className="flex items-center gap-1.5">
                <span className="truncate">{holding[0]!.title}</span>
                {holding.length > 1 && <span className="shrink-0">+{holding.length - 1}</span>}
              </span>
            ) : null}
          </td>
        )}
        {columns.has("tags") && (
          <td className={td}>
            {tags.length > 0 && (
              <span className="flex items-center gap-1.5" title={tags.length > 1 ? tags.join(", ") : undefined}>
                <TagDot tag={tags[0]} className="size-1.5" />
                <span className="truncate">{tags[0]}</span>
                {tags.length > 1 && <span className="shrink-0">+{tags.length - 1}</span>}
              </span>
            )}
          </td>
        )}
        {/* Unread is the default, so it says nothing */}
        {columns.has("status") && (
          <td className={td}>
            {/* A publisher waiting on the user (or one that turned them away) says so before the reading
                status, as the list row does */}
            {noPdfWord(paper) ?? (digest === "failed" ? t`Digest stopped` : paper.status === "unread" ? "" : statusLabel(paper.status))}
          </td>
        )}
        <td className={cn(td, "tabular-nums")}>
          {/* Owlit signs what it added, as everywhere it leaves something; the date gives way to the row's actions */}
          <span className="group-hover/row:hidden group-has-focus-key/row:hidden group-has-data-menu-up/row:hidden">
            {ago(paper.addedAt)}
            {paper.addedBy === "agent" && " · Owlit"}
          </span>
          <RowActions paper={paper} className="-my-1 -mr-1.5 justify-end" />
        </td>
      </tr>
    </RowMenu>
  )
}

// A row's card in the table, the paper's row staying where it was as its title line
const PeekRow = memo(function PeekRow({ paper, open, span }: { paper: Paper; open: boolean; span: number }) {
  return (
    <TablePeekRow open={open} span={span}>
      <PaperPeek paper={paper} rowActions className={tablePeekCard} />
    </TablePeekRow>
  )
})

// The same papers as a ruled table: a tinted header row, a hairline under each row, no grid.
// Column headers sort; clicking a row opens its card in a full-width row beneath it. Sorted by
// thread, the table falls into the list's groups, each under its thread's title.
export function PaperTable({ papers, groups, byThread, snippets }: { papers: Paper[]; groups?: PaperGroup[]; byThread?: ByThread; snippets?: ReadonlyMap<string, string> }) {
  const peekId = useLibraryUi((s) => s.peekId)
  const sort = useLibraryUi((s) => s.sort)
  const sortBy = useLibraryUi((s) => s.sortBy)
  const tagFilter = useLibraryUi((s) => s.tags)
  const table = useRef<HTMLTableElement>(null)
  const columns = useColumns(table, papers, byThread)
  // Kept while the same columns show, so the memoized rows aren't redrawn by every library change
  const keys = columns.map((c) => c.key).join(" ")
  const shown = useMemo(() => new Set(keys.split(" ") as ColumnKey[]), [keys])
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
              <HeadCell key={c.key} first={i === 0} last={i === columns.length - 1} aria-sort={active ? (sort.desc ? "descending" : "ascending") : undefined}>
                {"sort" in c ? (
                  <button
                    type="button"
                    onClick={() => sortBy(c.sort)}
                    className={cn("-mx-1 rounded px-1 hover:text-foreground", active && "text-foreground")}
                  >
                    {i18n._(c.label)}
                    {active && <span className="ml-1">{sort.desc ? "↓" : "↑"}</span>}
                  </button>
                ) : (
                  i18n._(c.label)
                )}
              </HeadCell>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {(groups ?? [{ label: null, papers }]).map((g, gi) => (
          <Fragment key={g.label ?? ""}>
            {g.label && (
              <tr>
                <td colSpan={columns.length} className={cn("px-0 pb-0", gi > 0 ? "pt-6" : "pt-2")}>
                  <GroupLabel as="div">{g.label}</GroupLabel>
                </td>
              </tr>
            )}
            {g.papers.map((p, i) => (
              <Fragment key={p.id}>
                <TableRow paper={p} peeked={p.id === peekId} last={i === g.papers.length - 1} columns={shown} snippet={snippets?.get(p.id)} tagFilter={tagFilter} holding={byThread?.get(p.id)} />
                <PeekRow paper={p} open={p.id === peekId} span={columns.length} />
              </Fragment>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
