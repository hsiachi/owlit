import { msg, t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { ago } from "@/lib/time"
import { i18n } from "@/lib/i18n"
import { MARK_CLOSE, MARK_OPEN, type CitedPaper, type Paper } from "@owlit/protocol"
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick, givesWayToRowMenu, RowMenuButton } from "@/components/action-menu"
import { GroupLabel } from "@/components/group-label"
import { revealOnHover } from "@/components/row-list"
import { NoteDot, ReadingRing, StoppedDot } from "@/components/marks"
import { HeadCell, TablePeekRow, tablePeekCard } from "@/components/ruled-table"
import { Unfold } from "@/components/unfold"
import { readDepthLabel } from "@/components/read-depth"
import { useDigestState, type DigestState } from "../digests"
import { type PaperGroup } from "../lib/filter"
import { pdfWait, pdfWord } from "../lib/pdf-wait"
import { citationsShort, citationsSource, citationsText, paperMeta, shortAuthors, shortVenue, venueOf } from "../lib/format"
import { statusLabel } from "../lib/status"
import { useTraceTitle } from "../lib/trace"
import { tagsFirst } from "../lib/tags"
import { useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"
import { PaperRowMenu } from "./PaperMenu"
import { PaperPeek } from "./PaperPeek"
import { PaperRow } from "./PaperRow"
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

// Star and ellipsis at the end of the table's last cell, shown while the row is hovered, holds keyboard
// focus or has its menu up. They float over the date, which gives way to them and keeps its room, so the
// row stays one line and Tab can still reach them (revealOnHover says why they fade rather than hide)
function RowActions({ paper }: { paper: Paper }) {
  return (
    <span className={cn("absolute top-1 right-1 flex items-center", revealOnHover)}>
      <RowStar paper={paper} />
      <RowMore id={paper.id} />
    </span>
  )
}

// The list row's end slot: the ellipsis, then the star at the far end, where a starred paper's star stays
// so the stars of a list line up. Both hold their place while faded out, so the details never shift.
// On an open card they show while the pointer is anywhere on it, so the card reads as one surface.
const ON_CARD_HOVER = "group-hover/card:opacity-100"

// In a project's scope a star is no column of the list: it shows with the actions, as an unstarred one does
function RowSlot({ paper, open, scoped }: { paper: Paper; open: boolean; scoped: boolean }) {
  return (
    <span className="flex shrink-0 items-center">
      <RowMore id={paper.id} className={cn(open && ON_CARD_HOVER)} />
      <RowStar paper={paper} className={paper.starred && !scoped ? undefined : cn(revealOnHover, open && ON_CARD_HOVER)} />
    </span>
  )
}

// How far Owlit read the paper for the project's citations, said apart from the person's own reading
const owlitDepth = (cited: CitedPaper) => {
  if (!cited.depth) return undefined
  const depth = readDepthLabel(cited.depth)
  return t({ message: `Owlit: ${depth}`, comment: "Library row in a project: how far Owlit read the paper for the project's citations, e.g. Owlit: Full text" })
}
const OWLIT_DEPTH_HINT = () => t`How far Owlit read it for the citations it wrote in this project`

// The person's reading and Owlit's, for a row in a project's scope: "Read · Owlit: Abstract only". Unread
// says nothing, as everywhere.
function readings(paper: Paper, cited: CitedPaper) {
  return [paper.status !== "unread" && statusLabel(paper.status), owlitDepth(cited)].filter(Boolean).join(" · ")
}

// "also cited in ADHD Support": the other projects citing a row's paper, each a step to that project's
// scope. bare: the names alone, under a column that says the rest.
function AlsoCited({ cited, bare, className }: { cited: CitedPaper; bare?: boolean; className?: string }) {
  if (!cited.also.length) return null
  const go = (project: string) => useLibraryUi.getState().setScope({ project })
  const names = cited.also.map((p, i) => (
    <Fragment key={p.path}>
      {i > 0 && ", "}
      <button
        type="button"
        onClick={() => go(p.path)}
        className="rounded-sm underline decoration-muted-foreground/40 underline-offset-3 outline-none hover:text-foreground hover:decoration-foreground/40 focus-key:text-foreground focus-key:ring-2 focus-key:ring-ring/50"
      >
        {p.name}
      </button>
    </Fragment>
  ))
  return (
    <span className={cn("truncate text-detail text-muted-foreground", className)} title={cited.also.map((p) => p.name).join(", ")}>
      {bare ? names : <Trans comment="Library row in a project: the other projects whose docs cite this paper, each a link">also cited in {names}</Trans>}
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

// Where the paper's digest stands, on the ladder of states: Owlit's dot once it is new since the user
// looked, red when its chat broke (the row says so in words too). One being written shows on the paper's
// Digest side, not in the list.
function DigestMark({ state }: { state: DigestState }) {
  if (state === "new") return <NoteDot label={t`New digest`} />
  if (state === "failed") return <StoppedDot label={t`Digest stopped`} />
  return null
}

// A paper without its PDF says where it stands in its row, in the word its No PDF group and its card use
const noPdfWord = (p: Paper) => pdfWord(pdfWait(p))

// The slot before a title in the list, as in the chat list: empty for an unread paper, a half-filled ring
// while it is being read, the digest's mark while it has one. Every row has the slot, so titles start at
// one place and the ring comes or goes without moving the row.
function PaperStatusMark({ paper, digest }: { paper: Paper; digest: DigestState }) {
  const label = paper.status === "reading" ? statusLabel("reading") : undefined
  const trace = useTraceTitle(paper)
  if (digest === "new" || digest === "failed") {
    return (
      <span className="grid size-4 shrink-0 place-items-center">
        <DigestMark state={digest} />
      </span>
    )
  }
  return (
    <span className="grid size-4 shrink-0 place-items-center" title={label && trace.title ? `${label} · ${trace.title}` : label} onPointerEnter={label ? trace.ask : undefined}>
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
const ListItem = memo(function ListItem({ paper, peeked, snippet, cited }: { paper: Paper; peeked: boolean; snippet?: string; cited?: CitedPaper }) {
  const selected = useSelected(paper.id)
  const digest = useDigestState(paper)
  // A publisher waiting on the user (or one that turned them away), or a digest that stopped, says so in
  // words, first among the row's details; in a project's scope, the person's reading and Owlit's follow
  const said = [noPdfWord(paper), digest === "failed" && t`Digest stopped`, cited && readings(paper, cited), paperMeta(paper)].filter(Boolean).join(" · ")
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
          meta={
            cited?.also.length ? (
              <span className="flex min-w-0 items-baseline gap-1">
                <span className="truncate" title={cited.depth ? OWLIT_DEPTH_HINT() : undefined}>
                  {said && `${said} ·`}
                </span>
                <AlsoCited cited={cited} className="max-w-[60%] shrink-0" />
              </span>
            ) : (
              <span title={cited?.depth ? OWLIT_DEPTH_HINT() : undefined}>{said}</span>
            )
          }
          slot={<RowSlot paper={paper} open={peeked} scoped={!!cited} />}
          below={snippet && <TextSnippet text={snippet} className={cn("pr-14", peeked ? "pb-1.5" : "pl-7")} />}
        />
      </RowMenu>
      <Unfold open={peeked}>
        <PaperPeek paper={paper} className="px-2.5 pb-1.5" />
      </Unfold>
    </div>
  )
})

// cited: a project's papers, when the list is scoped to one (scope.ts)
export function PaperList({ groups, snippets, cited }: { groups: PaperGroup[]; snippets?: ReadonlyMap<string, string>; cited?: ReadonlyMap<string, CitedPaper> | null }) {
  const peekId = useLibraryUi((s) => s.peekId)
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g, i) => (
        <section key={g.label ?? i}>
          {g.label && <GroupLabel>{g.label}</GroupLabel>}
          {g.papers.map((p) => (
            <ListItem key={p.id} paper={p} peeked={p.id === peekId} snippet={snippets?.get(p.id)} cited={cited?.get(p.id)} />
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
  // In a project's scope: the other projects citing the paper, and, in place of Tags and Status, the
  // person's reading beside Owlit's
  { key: "also", label: msg({ message: "Also cited in", comment: "Library table in a project: the other projects whose docs cite the paper" }), width: 144 },
  { key: "reading", label: msg({ message: "Reading", context: "table column", comment: "Library table in a project: the person's reading of a paper beside how far Owlit read it" }), width: 168 },
  { key: "added", label: msg({ message: "Added", context: "when the paper was added to the library" }), width: 96, sort: "addedAt" },
] as const

type Column = (typeof COLUMNS)[number]
type ColumnKey = Column["key"]

// The title is what identifies a paper, so it never gets narrower than this. When the table
// can't fit every column, they give way least-needed first; Year and Added (which holds the
// row's actions) always stay.
const TITLE_MIN = 320
const GIVE_WAY: ColumnKey[] = ["citations", "venue", "thread", "status", "tags", "also", "reading", "authors"]

// The threads that hold each paper, most recently changed first
type ByThread = ReadonlyMap<string, { id: string; title: string }[]>

// Columns no paper in view fills (no tags yet, every paper unread) are left out rather than shown blank
const FILLED: Partial<Record<ColumnKey, (p: Paper) => boolean>> = {
  venue: (p) => !!venueOf(p),
  citations: (p) => !!p.citations,
  tags: (p) => p.tags.length > 0,
  status: (p) => p.status !== "unread" || !!noPdfWord(p),
}

// The columns a project's scope leaves out, and the one only it shows
const OUT_OF_SCOPE: ColumnKey[] = ["tags", "status"]
const IN_SCOPE: ColumnKey[] = ["also", "reading"]

function useColumns(table: React.RefObject<HTMLTableElement | null>, papers: Paper[], byThread: ByThread | undefined, cited: ReadonlyMap<string, CitedPaper> | null | undefined): Column[] {
  const kept = useMemo(() => {
    const filled = { ...FILLED, thread: (p: Paper) => !!byThread?.get(p.id)?.length, also: (p: Paper) => !!cited?.get(p.id)?.also.length }
    return COLUMNS.filter((c) => !(cited ? OUT_OF_SCOPE : IN_SCOPE).includes(c.key) && (!filled[c.key] || papers.some(filled[c.key]!))) as Column[]
  }, [papers, byThread, cited])
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

type TableRowProps = { paper: Paper; peeked: boolean; last: boolean; columns: Set<ColumnKey>; snippet?: string; tagFilter: string[]; holding?: { id: string; title: string }[]; cited?: CitedPaper }

// The threads holding a paper come fresh from every library change, so they are compared by what they say
const sameHolding = (a: TableRowProps["holding"], b: TableRowProps["holding"]) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((c, i) => c.id === b[i]!.id && c.title === b[i]!.title))

const TableRow = memo(TableRowView, (a, b) => {
  for (const key of Object.keys(a) as (keyof TableRowProps)[]) if (key !== "holding" && !Object.is(a[key], b[key])) return false
  return Object.keys(a).length === Object.keys(b).length && sameHolding(a.holding, b.holding)
})

function TableRowView({ paper, peeked, last, columns, snippet, tagFilter, holding, cited }: TableRowProps) {
  const selected = useSelected(paper.id)
  const digest = useDigestState(paper)
  // How far the person got, on hover of the Status cell
  const trace = useTraceTitle(paper)
  const tags = tagsFirst(paper.tags, tagFilter)
  // Square cells with a hairline under each row (none under the last, nor over an open card), as in answer
  // tables. Cells hold their text at the top, so an open row's wrapped title keeps its first line in place.
  const td = cn(
    "h-9 truncate border-b px-2.5 py-2 align-top text-detail leading-5 text-muted-foreground group-hover/row:bg-muted",
    (last || peeked) && "border-b-transparent",
    selected && "bg-accent group-hover/row:bg-accent",
  )
  const full = venueOf(paper)
  const venue = full && shortVenue(full)
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
            {/* The table has no status slot: the digest's mark follows the title, as the star does outside a
                project's scope */}
            <span className="flex h-5 shrink-0 items-center gap-2">
              <DigestMark state={digest} />
              {paper.starred && !cited && <StarMark />}
            </span>
          </span>
          {snippet && <TextSnippet text={snippet} className="max-w-xl pb-1.5" />}
        </td>
        {columns.has("authors") && <td className={td}>{shortAuthors(paper.authors)}</td>}
        <td className={cn(td, "tabular-nums")}>{paper.year}</td>
        {columns.has("venue") && (
          <td className={td} title={full}>
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
          <td className={td} title={trace.title} onPointerEnter={trace.ask}>
            {/* A publisher waiting on the user (or one that turned them away) says so before the reading
                status, as the list row does */}
            {noPdfWord(paper) ?? (digest === "failed" ? t`Digest stopped` : paper.status === "unread" ? "" : statusLabel(paper.status))}
          </td>
        )}
        {columns.has("also") && <td className={td}>{cited && <AlsoCited cited={cited} bare className="block" />}</td>}
        {columns.has("reading") && cited && (
          <td className={td} title={[trace.title, cited.depth && OWLIT_DEPTH_HINT()].filter(Boolean).join("\n") || undefined} onPointerEnter={trace.ask}>
            {[noPdfWord(paper), readings(paper, cited)].filter(Boolean).join(" · ")}
          </td>
        )}
        <td className={cn(td, "relative tabular-nums")}>
          {/* The date alone: Owlit adds most papers, so a mark on its rows would say nothing (the card and the
              paper page say who added it). It gives way to the row's actions */}
          <span className={givesWayToRowMenu}>{ago(paper.addedAt)}</span>
          <RowActions paper={paper} />
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
export function PaperTable({
  papers,
  groups,
  byThread,
  snippets,
  cited,
}: {
  papers: Paper[]
  groups?: PaperGroup[]
  byThread?: ByThread
  snippets?: ReadonlyMap<string, string>
  cited?: ReadonlyMap<string, CitedPaper> | null
}) {
  const peekId = useLibraryUi((s) => s.peekId)
  const sort = useLibraryUi((s) => s.sort)
  const sortBy = useLibraryUi((s) => s.sortBy)
  const tagFilter = useLibraryUi((s) => s.tags)
  const table = useRef<HTMLTableElement>(null)
  const columns = useColumns(table, papers, byThread, cited)
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
                <TableRow paper={p} peeked={p.id === peekId} last={i === g.papers.length - 1} columns={shown} snippet={snippets?.get(p.id)} tagFilter={tagFilter} holding={byThread?.get(p.id)} cited={cited?.get(p.id)} />
                <PeekRow paper={p} open={p.id === peekId} span={columns.length} />
              </Fragment>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}
