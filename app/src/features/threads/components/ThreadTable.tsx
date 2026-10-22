import { plural, t } from "@lingui/core/macro"
import { readDepthLabel } from "@/components/read-depth"
import { fromText, itemId, readInFull, type ThreadRead, type ThreadCell, type ThreadColumn, type ThreadRowRead, type Relation } from "@owlit/protocol"
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import { ChoiceMenu } from "@/components/choice-menu"
import { NoteDot } from "@/components/marks"
import { useSeenOnScreen, type VisitDots } from "../seen"
import { HeadCell, TablePeekRow, tablePeekCard } from "@/components/ruled-table"
import { FoldButton } from "@/components/fold"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { displayName } from "@/features/docs/types"
import { cn, scrollMotion } from "@/lib/utils"
import { citeOf, columnLabel, type GroupBy, groupByOf, groupingsWithGroups, paperFacts, relWord, type Section, sectionsOf, useLibraryPaper } from "../lib"
import { editThread } from "../store"
import { ReadingMark, RowPeek } from "./AnswerRows"
import { useThreadsUi } from "../ui-store"

// A thread with columns, as a ruled table like the Library's: a row per paper with what it is, a column
// per question asked of every paper, a comparison with a doc as a column of plain words. Owlit's groups are
// sections that fold. A row opens the paper's card under it, from any cell, where the words each answer
// rests on are. Everything in it is Owlit's: the user changes it by asking in a chat, and here only chooses
// what it is grouped by.

// Rows a group shows before "Show N more"
const SHOWN = 8

function relCounts(rows: ThreadRowRead[], column: ThreadColumn | undefined) {
  if (!column) return ""
  const n = { supports: 0, challenges: 0, related: 0 }
  for (const r of rows) {
    const rel = r.cells[column.id]?.rel
    if (rel) n[rel]++
  }
  // The column's own words with a number after each, so the counts read as tallies beside "5 papers"
  return (["supports", "challenges", "related"] as const)
    .filter((rel) => n[rel])
    .map((rel) => `${relWord(rel)} ${n[rel]}`)
    .join(" · ")
}

export function ThreadTable({ thread, shown, visit }: { thread: ThreadRead; shown: ThreadRead; visit: VisitDots }) {
  // A grouping is the table's sections, never a column of its own
  const columns = shown.columns.filter((c) => !c.hidden && c.kind !== "grouping")
  const compare = columns.find((c) => c.kind === "compare")
  const groupings = groupingsWithGroups(shown)
  // What the table is grouped by is remembered for the thread (its view); chosen here, it shows at once
  const [chosen, setChosen] = useState<GroupBy>()
  const groupBy = groupByOf(shown, chosen ?? thread.view?.groupBy)
  const setGroupBy = (value: GroupBy) => {
    setChosen(value)
    void editThread(thread.id, { op: "view", groupBy: value })
  }
  const [sort, setSort] = useState<string>("order")
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [all, setAll] = useState<Set<string>>(new Set())
  const [peek, setPeek] = useState<string | null>(null)
  // A row asked for from elsewhere (a link to one of its papers) opens where it first appears
  const asked = useThreadsUi((s) => s.peek)

  const sortRows = (rows: ThreadRowRead[]) => {
    if (sort === "title") return [...rows].sort((a, b) => a.paper.title.localeCompare(b.paper.title))
    if (sort === "year") return [...rows].sort((a, b) => (b.paper.year ?? 0) - (a.paper.year ?? 0))
    if (sort.startsWith("column:")) {
      const col = sort.slice(7)
      // What cuts against the user's sentences first: the papers most worth a look
      const order: Record<Relation, number> = { challenges: 0, supports: 1, related: 2 }
      const rank = (r: ThreadRowRead) => {
        const rel = r.cells[col]?.rel
        return rel ? order[rel] : 3
      }
      return [...rows].sort((a, b) => rank(a) - rank(b))
    }
    return rows
  }

  const sections = sectionsOf(shown, groupBy)

  // Where each paper shows: a paper in several groups is a whole row in each, the first of them the one a
  // link to it opens
  const places = new Map<string, Section[]>()
  for (const s of sections) for (const r of s.rows) places.set(r.id, [...(places.get(r.id) ?? []), s])
  const placeKey = (s: Section, rowId: string) => `${s.key}:${rowId}`
  const isOpen = (s: Section, rowId: string) => peek === placeKey(s, rowId) || (peek === null && asked === rowId && places.get(rowId)?.[0] === s)
  // To a paper's other place: its group unfolded and showing all, the row brought into view, ringing twice
  const jump = (s: Section, rowId: string) => {
    setFolded((f) => (f.has(s.key) ? (f.delete(s.key), new Set(f)) : f))
    setAll((a) => (a.has(s.key) ? a : new Set(a).add(s.key)))
    requestAnimationFrame(() => {
      const row = body.current?.querySelector<HTMLElement>(`[data-place="${CSS.escape(placeKey(s, rowId))}"]`)
      if (!row) return
      row.scrollIntoView({ block: "center", behavior: scrollMotion() })
      const cell = row.querySelector<HTMLElement>("td")
      cell?.classList.remove("animate-place-ring")
      void cell?.offsetWidth
      cell?.classList.add("animate-place-ring")
      cell?.addEventListener("animationend", () => cell.classList.remove("animate-place-ring"), { once: true })
    })
  }
  // A row asked for from elsewhere that its group hides (folded, or past the first SHOWN) unfolds the group
  // and shows it whole, as jump does, or the link would open nothing
  const askedAt = asked ? places.get(asked)?.[0] : undefined
  const askedHidden = !!askedAt && (folded.has(askedAt.key) || (!all.has(askedAt.key) && sortRows(askedAt.rows).findIndex((r) => r.id === asked) >= SHOWN))
  useEffect(() => {
    if (asked && askedAt && askedHidden) jump(askedAt, asked)
    // Only when a row is asked for: folding its group again afterwards is the user's to do
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked])
  const span = columns.length + 2
  const root = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  // One table's sideways scroll, given to the other; while scrolled, the pinned column shows its edge
  const follow = (from: HTMLElement | null, to: HTMLElement | null) => {
    if (!from || !to) return
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft
    root.current?.toggleAttribute("data-scrolled", from.scrollLeft > 0)
  }
  const width = `max(100%, calc(${PAPER} + ${IS} + ${columns.length} * ${ANSWER}))`
  const cols = (
    <colgroup>
      <col style={{ width: PAPER }} />
      <col style={{ width: IS }} />
      {columns.map((c) => (
        <col key={c.id} />
      ))}
    </colgroup>
  )
  const groupOptions = [
    ...groupings.map((c) => ({ value: `grouping:${c.id}` as GroupBy, label: columnLabel(c) })),
    ...columns.filter((c) => c.kind === "compare").map((c) => ({ value: `column:${c.id}` as GroupBy, label: t`Sentences of ${displayName(c.doc ?? c.question)}` })),
    { value: "none" as GroupBy, label: t({ message: "None", comment: "no grouping" }) },
  ]
  return (
    <div ref={root} className="group/table mt-8">
      <div className="mb-2 -ml-2 flex flex-wrap items-center gap-1">
        <GroupByMenu value={groupBy} options={groupOptions} onChange={setGroupBy} />
        <ChoiceMenu
          value={sort}
          onChange={setSort}
          label={t`Sort`}
          trigger={<GroupWord label={t`Sort`} value={undefined} />}
          align="start"
          options={[
            { value: "order", label: t({ message: "As gathered", comment: "sort: the order Owlit added papers in" }) },
            { value: "title", label: t`Title` },
            { value: "year", label: t({ message: "Newest first", comment: "sort papers by year" }) },
            ...columns.filter((c) => c.kind === "compare").map((c) => ({ value: `column:${c.id}`, label: columnLabel(c) })),
          ]}
        />
      </div>
      {/* The header is a table of its own over the body's, so it can stick to the page's top while the body
          scrolls sideways (a sideways scroller would also hold it vertically), and follows the body's sideways
          scroll. Both tables take the same width and columns, so they line up. */}
      <div ref={head} onScroll={() => follow(head.current, body.current)} className="sticky top-0 z-10 overflow-x-auto [scrollbar-width:none]">
        <table className="table-fixed border-separate border-spacing-0" style={{ width }}>
          {cols}
          <thead>
            <tr>
              <HeadCell first className={cn("left-0 z-20", pinnedEdge)}>
                {t`Paper`}
              </HeadCell>
              <HeadCell>{t({ message: "What it is", comment: "table column: what kind of paper each is and its material" })}</HeadCell>
              {columns.map((c, i) => (
                <HeadCell key={c.id} last={i === columns.length - 1}>
                  <span className="block truncate" title={c.kind === "compare" ? c.sentences?.map((s) => s.text).join("\n") : c.question}>
                    {columnLabel(c)}
                  </span>
                </HeadCell>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      {/* A container, so what spans the row (a group, a card) can be as wide as the visible part, pinned there */}
      <div ref={body} onScroll={() => follow(body.current, head.current)} className="@container overflow-x-auto">
        <table className="table-fixed border-separate border-spacing-0" style={{ width }}>
          {cols}
          <tbody>
            {sections.map((s) => {
              const open = !folded.has(s.key)
              const rows = sortRows(s.rows)
              const many = rows.length > SHOWN && !all.has(s.key)
              return (
                <Fragment key={`${s.key}:${s.depth}`}>
                  {s.label && (
                    <GroupRow
                      section={s}
                      open={open}
                      span={span}
                      count={plural(s.total.length, { one: "# paper", other: "# papers" })}
                      rels={relCounts(s.total, compare)}
                      onToggle={() => setFolded((f) => (f.has(s.key) ? (f.delete(s.key), new Set(f)) : new Set(f).add(s.key)))}
                    />
                  )}
                  {open &&
                    (many ? rows.slice(0, SHOWN) : rows).map((r) => (
                      <Fragment key={r.id}>
                        <TableRow
                          thread={thread}
                          row={r}
                          place={placeKey(s, r.id)}
                          first={places.get(r.id)?.[0] === s}
                          others={(places.get(r.id) ?? []).filter((o) => o !== s)}
                          onJump={(o) => jump(o, r.id)}
                          columns={columns}
                          // Grouped by a comparison's sentences, the group says which sentence; one sentence
                          // needs no saying
                          sentenceShown={(c) => groupBy !== `column:${c.id}` && (c.sentences?.length ?? 0) > 1}
                          indent={s.label ? s.depth + 1 : 0}
                          visit={visit}
                          open={isOpen(s, r.id)}
                          onOpen={() => {
                            useThreadsUi.getState().set({ peek: null })
                            setPeek(isOpen(s, r.id) ? "" : placeKey(s, r.id))
                          }}
                        />
                        <PeekRow thread={thread} row={r} open={isOpen(s, r.id)} span={span} />
                      </Fragment>
                    ))}
                  {open && many && (
                    <tr>
                      <td colSpan={span} className="border-b p-0">
                        <div className={cn(inView, "py-1.5")} style={{ paddingLeft: 10 + (s.label ? (s.depth + 1) * 20 : 0) }}>
                          <FoldButton open={false} onClick={() => setAll((a) => new Set(a).add(s.key))}>
{plural(rows.length - SHOWN, { one: "# more", other: "# more" })}
</FoldButton>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// The Paper column's width, What it is's (a short line: "Field study, 12 participants"), and the least an
// answer column takes: answers share what is left, and once they would get less, the table scrolls
// sideways under the Paper column, which stays
const PAPER = "18rem"
const IS = "11rem"
const ANSWER = "15rem"

// What spans a row (a group's line, "N more") is as wide as the visible part of the table and stays there
// while the table scrolls sideways
const inView = "sticky left-0 w-[100cqw]"

// While the table is scrolled sideways, a hairline marks where the pinned column ends
const pinnedEdge = "group-data-scrolled/table:shadow-[inset_-1px_0_0_var(--color-border)]"

// The pinned column keeps the sheet under it, so cells passing beneath don't show through, and its hover
// fill is the row's (translucent) laid over that sheet
const pinnedCell = "sticky left-0 z-[1] bg-background group-hover/row:[background-image:linear-gradient(var(--color-muted),var(--color-muted))]"

// Group by: the thread's groupings, its comparisons' sentences, or none
function GroupByMenu({ value, options, onChange }: { value: GroupBy; options: { value: GroupBy; label: string }[]; onChange: (value: GroupBy) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="font-normal text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground">
          <GroupWord label={t`Group by`} value={options.find((o) => o.value === value)?.label} />
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto max-w-80 min-w-48">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => o.value !== value && onChange(o.value)}>
            <span className="flex-1 truncate">{o.label}</span>
            {o.value === value && <CheckIcon className="text-muted-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function GroupWord({ label, value }: { label: string; value: string | undefined }) {
  return (
    <span>
      {label}
      {value && <span className="ml-1 text-foreground">{value}</span>}
    </span>
  )
}

function GroupRow({ section, open, span, count, rels, onToggle }: { section: Section; open: boolean; span: number; count: string; rels: string; onToggle: () => void }) {
  return (
    <tr className="group/row">
      <td colSpan={span} className="border-b p-0">
        <div className={cn(inView, "flex items-center gap-2 pt-4 pb-1.5")} style={{ paddingLeft: 6 + section.depth * 20 }}>
          <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none hover:bg-muted focus-key:bg-muted">
            <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--t-layout)", open && "rotate-90")} />
            <span className={cn("text-sm", section.depth === 0 ? "font-medium" : "", section.sentence && "font-normal")}>{section.label}</span>
          </button>
          {section.one && <span className="min-w-0 truncate text-detail text-muted-foreground">{section.one}</span>}
          <span className="ml-auto shrink-0 pr-1.5 text-detail text-muted-foreground tabular-nums">{[count, rels].filter(Boolean).join(" · ")}</span>
        </div>
      </td>
    </tr>
  )
}

// A paper in several groups is a whole row in each, the same everywhere, with one muted line under its name
// saying where else it is; each name there goes to that row. A click anywhere in the row opens its card
// (not one that ends a selection of words); from the keyboard, the Paper cell is the row's button.
function TableRow({
  thread,
  row,
  place,
  first,
  others,
  onJump,
  columns,
  sentenceShown,
  indent,
  visit,
  open,
  onOpen,
}: {
  thread: ThreadRead
  row: ThreadRowRead
  place: string
  first: boolean
  others: Section[]
  onJump: (section: Section) => void
  columns: ThreadColumn[]
  sentenceShown: (column: ThreadColumn) => boolean
  indent: number
  visit: VisitDots
  open: boolean
  onOpen: () => void
}) {
  const library = useLibraryPaper(row)
  const facts = paperFacts(row, library)
  const fresh = visit.fresh(itemId.row(row.id))
  const seenRef = useSeenOnScreen<HTMLTableRowElement>(thread.id, [itemId.row(row.id), ...columns.map((c) => itemId.cell(row.id, c.id))])
  const td = cn("border-b px-2.5 py-2 align-top text-detail leading-5", open && "border-b-transparent")
  return (
    <tr
      ref={seenRef}
      id={first ? `row-${row.id}` : undefined}
      data-place={place}
      className="group/row cursor-default"
      onClick={() => {
        if (!window.getSelection()?.isCollapsed) return
        onOpen()
      }}
    >
      <td
        role="button"
        tabIndex={0}
        aria-expanded={open}
        className={cn(td, pinnedCell, pinnedEdge, "text-sm outline-none focus-key:[background-image:linear-gradient(var(--color-muted),var(--color-muted))]")}
        style={{ paddingLeft: 10 + indent * 20 }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return
          e.preventDefault()
          onOpen()
        }}
      >
        <span className="flex items-start gap-2">
          <span className={cn(open ? "font-medium text-balance" : "line-clamp-2")}>{facts.title}</span>
          {/* Owlit's dot for a new row and the user's reading are two facts, so both can show */}
          <span className="flex h-5 shrink-0 items-center gap-1.5">
            {fresh && <NoteDot />}
            <ReadingMark paper={library} />
          </span>
        </span>
        <span className="block truncate text-detail text-muted-foreground">{citeOf(facts)}</span>
        {others.length > 0 && (
          <span className="block truncate text-detail text-muted-foreground">
            {t({ message: "Also in", comment: "followed by the other groups of this thread that hold the paper" })}{" "}
            {others.map((o, i) => (
              <Fragment key={o.key}>
                {i > 0 && " · "}
                {/* Inline text, not a button box, so a long name is cut by the line's ellipsis like any text */}
                <span
                  role="button"
                  tabIndex={0}
                  className="rounded-sm outline-none hover:text-foreground hover:underline focus-key:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    onJump(o)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return
                    e.stopPropagation()
                    onJump(o)
                  }}
                >
                  {o.label}
                </span>
              </Fragment>
            ))}
          </span>
        )}
      </td>
      <td className={cn(td, "text-foreground group-hover/row:bg-muted")}>{row.is}</td>
      {columns.map((c) => (
        <td key={c.id} className={cn(td, "group-hover/row:bg-muted")}>
          <Cell column={c} cell={row.cells[c.id]} fresh={visit.fresh(itemId.cell(row.id, c.id))} reread={readInFull(visit.changeOf(itemId.cell(row.id, c.id)))} showSentence={sentenceShown(c)} />
        </td>
      ))}
    </tr>
  )
}

function PeekRow({ thread, row, open, span }: { thread: ThreadRead; row: ThreadRowRead; open: boolean; span: number }) {
  const library = useLibraryPaper(row)
  return (
    <TablePeekRow open={open} span={span} pinned>
      <RowPeek thread={thread} row={row} library={library} className={tablePeekCard} />
    </TablePeekRow>
  )
}

// A cell: Owlit's answer, in ink like the short list's, ending in its page when it came from the text;
// one from the title only is thin, so muted. A comparison says how the paper stands and why, Owlit's reason
// being what the user doesn't know yet; their own sentence is one muted line under it only where nothing
// else says which one. The words it rests on are on the row's card.
// reread: the dot's change is Owlit answering again from the text: the page's place says so while the
// dot lasts.
function Cell({ column, cell, fresh, reread, showSentence }: { column: ThreadColumn; cell: ThreadCell | undefined; fresh: boolean; reread: ReturnType<typeof readInFull>; showSentence: boolean }) {
  if (!cell) return <span className="text-muted-foreground/60">…</span>
  // No bearing on any of the user's sentences: nothing to say
  if (column.kind === "compare" && !cell.rel) return <span title={cell.text} />
  const sentence = column.sentences?.find((s) => s.id === cell.sentence)
  const text = cell.text
  const page = fromText(cell.depth) && cell.passage ? cell.passage.page : undefined
  // The words wrap in a narrow column; the page stays on one line, as it does alone
  const pageMark =
    fresh && reread ? (
      <span className="ml-1 text-owlit">
        {t({ message: "Changed after reading the text", comment: "chip on a thread cell Owlit answered again from the paper's text" })}
        {page && <span className="whitespace-nowrap tabular-nums"> · {t({ message: `p. ${page}`, comment: "a page of a paper" })}</span>}
      </span>
    ) : (
      // The page alone, in a dense table; how far Owlit read (full text, part of the text) on hover, in the
      // words the row's card and the line over the papers say
      page && (
        <span className="ml-1 whitespace-nowrap text-muted-foreground tabular-nums" title={readDepthLabel(cell.depth)}>
          {t({ message: `p. ${page}`, comment: "a page of a paper" })}
        </span>
      )
    )
  return (
    <span className="line-clamp-4">
      {fresh && <NoteDot className="mr-1.5 mb-px align-middle" />}
      {column.kind === "compare" && cell.rel ? (
        <>
          <span className={cn("font-medium", cell.rel === "related" ? "font-normal text-muted-foreground" : "text-foreground")}>{relWord(cell.rel)}</span>
          {text && <span className="text-foreground"> · {text}</span>}
          {pageMark}
          {showSentence && sentence && <span className="block truncate text-muted-foreground">“{sentence.text}”</span>}
        </>
      ) : (
        <span className={cell.depth === "title" ? "text-muted-foreground" : "text-foreground"}>
          {text}
          {pageMark}
        </span>
      )}
    </span>
  )
}
