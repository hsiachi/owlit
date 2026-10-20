import { plural, t } from "@lingui/core/macro"
import { itemId, readInFull, type ThreadRead, type ThreadCell, type ThreadColumn, type ThreadGroup, type ThreadRowRead, type Relation } from "@owlit/protocol"
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Fragment, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChoiceMenu } from "@/components/choice-menu"
import { citationCardSurface } from "@/components/citation"
import { CitationCard } from "@/components/citation-card"
import { NoteDot } from "@/components/marks"
import { useReadInFull, useSeenOnScreen, type VisitDots } from "../seen"
import { MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { HeadCell, TablePeekRow, tablePeekCard } from "@/components/ruled-table"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { displayName } from "@/features/docs/types"
import { cn, scrollMotion } from "@/lib/utils"
import { citeOf, columnLabel, groupSections, paperFacts, passageRoute, relWord, useLibraryPaper } from "../lib"
import { editThread } from "../store"
import { ReadingMark, RowPeek, WasLine } from "./AnswerRows"
import { useThreadWork } from "../work"
import { useThreadsUi } from "../ui-store"

// A thread with columns, as a ruled table like the Library's: a row per paper, a column per question
// asked of every paper, a comparison with a doc as a column of plain words. Groups are Owlit's and fold; a
// row opens its card under it; a cell opens to show the words it rests on. Everything in it is Owlit's: the
// user changes it by asking in a chat, and here only chooses what it is grouped by.

// Rows a group shows before "Show N more"
const SHOWN = 8

// A grouping (its column), a comparison's sentences, or none
type GroupBy = "none" | `grouping:${string}` | `column:${string}`

interface Section {
  key: string
  group?: ThreadGroup
  // The grouping it is a group of
  grouping?: ThreadColumn
  // A sentence of the user's, when grouped by a comparison
  sentence?: { id: string; text: string }
  label: string
  one?: string
  rows: ThreadRowRead[]
  // Its rows and its subgroups' rows, which its counts cover
  total: ThreadRowRead[]
  depth: number
}

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
  // Groupings Owlit is working out now: a column while it works, so its header says how far it got, and
  // nothing to group by until it is done
  const filling = useThreadWork(thread.id).running.flatMap((chat) => (chat.about.column ? [chat.about.column] : []))
  const columns = shown.columns.filter((c) => !c.hidden || (c.kind === "grouping" && filling.includes(c.id)))
  const compare = columns.find((c) => c.kind === "compare")
  const groupings = shown.columns.filter((c) => c.kind === "grouping" && c.groups?.length && !filling.includes(c.id))
  // What the table is grouped by is remembered for the thread (its view); one that isn't there (a
  // grouping still being worked out, a comparison hidden) gives way to the first grouping
  const [chosen, setChosen] = useState<GroupBy>()
  const want = chosen ?? (thread.view?.groupBy as GroupBy | undefined)
  const groupBy: GroupBy =
    want === "none" ||
    (want?.startsWith("grouping:") && groupings.some((c) => c.id === want.slice(9))) ||
    (want?.startsWith("column:") && columns.some((c) => c.kind === "compare" && c.id === want.slice(7)))
      ? want!
      : groupings[0]
        ? `grouping:${groupings[0].id}`
        : "none"
  const setGroupBy = (value: GroupBy) => {
    setChosen(value)
    void editThread(thread.id, { op: "view", groupBy: value })
  }
  const grouping = groupBy.startsWith("grouping:") ? groupings.find((c) => c.id === groupBy.slice(9)) : undefined
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

  const sections: Section[] = []
  if (grouping) {
    const { groups, loose } = groupSections(shown, grouping)
    for (const g of groups) sections.push({ key: g.group.id, group: g.group, grouping, label: g.group.name, one: g.group.one, rows: g.rows, total: g.total, depth: g.depth })
    if (loose.length) sections.push({ key: "", label: t({ message: "Not in a group", comment: "papers of a thread in none of its groups" }), rows: loose, total: loose, depth: 0 })
  } else if (groupBy.startsWith("column:")) {
    const col = columns.find((c) => c.id === groupBy.slice(7))
    for (const s of col?.sentences ?? []) {
      const rows = shown.rows.filter((r) => r.cells[col!.id]?.sentence === s.id && r.cells[col!.id]?.rel)
      sections.push({ key: s.id, sentence: s, label: s.text, rows, total: rows, depth: 0 })
    }
    const none = shown.rows.filter((r) => !r.cells[col?.id ?? ""]?.rel)
    if (none.length) sections.push({ key: "", label: t({ message: "Bear on none of them", comment: "papers that speak to none of the user's sentences" }), rows: none, total: none, depth: 0 })
  } else {
    sections.push({ key: "", label: "", rows: shown.rows, total: shown.rows, depth: 0 })
  }

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
  const width = `max(100%, calc(${PAPER} + ${PLUS} + ${columns.length} * ${ANSWER}))`
  const cols = (
    <colgroup>
      <col style={{ width: PAPER }} />
      {columns.map((c) => (
        <col key={c.id} />
      ))}
      <col style={{ width: PLUS }} />
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
              {columns.map((c) => (
                <HeadCell key={c.id}>
                  <ColumnHeader thread={thread} column={c} />
                </HeadCell>
              ))}
              <HeadCell last />
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
                          <Button variant="text" size="inline" onClick={() => setAll((a) => new Set(a).add(s.key))}>
                            <ChevronDownIcon />
                            {plural(rows.length - SHOWN, { one: "# more", other: "# more" })}
                          </Button>
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

// The Paper column's width, and the least an answer column takes: answers share what is left, and once
// they would get less, the table scrolls sideways under the Paper column, which stays
const PAPER = "18rem"
const ANSWER = "15rem"
const PLUS = "40px"

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

// A column's name; while Owlit fills it, how far it got
function ColumnHeader({ thread, column }: { thread: ThreadRead; column: ThreadColumn }) {
  const filling = useThreadWork(thread.id).running.some((chat) => chat.about.column === column.id)
  // A grouping counts the papers Owlit has put in a group so far
  const done = thread.rows.filter((r) => (column.kind === "grouping" ? r.in?.[column.id]?.length : r.cells[column.id])).length
  const of = thread.rows.length
  return (
    <span className="flex items-center" title={column.kind === "compare" ? column.sentences?.map((s) => s.text).join("\n") : column.question}>
      <span className="truncate">{columnLabel(column)}</span>
      {filling && <span className="shimmer ml-1.5 font-normal tabular-nums">{t`${done} of ${of}`}</span>}
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
// saying where else it is; each name there goes to that row
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
    <tr ref={seenRef} id={first ? `row-${row.id}` : undefined} data-place={place} className="group/row">
      <td className={cn(td, pinnedCell, pinnedEdge, "cursor-default text-sm")} style={{ paddingLeft: 10 + indent * 20 }} onClick={onOpen}>
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
      {columns.map((c) => (
        <td key={c.id} className={cn(td, "group-hover/row:bg-muted")}>
          {c.kind === "grouping" ? (
            <GroupsCell column={c} row={row} />
          ) : (
            <Cell thread={thread} row={row} column={c} cell={row.cells[c.id]} fresh={visit.fresh(itemId.cell(row.id, c.id))} reread={readInFull(visit.changeOf(itemId.cell(row.id, c.id)))} showSentence={sentenceShown(c)} libraryId={library?.id} />
          )}
        </td>
      ))}
      <td className={cn(td, "py-1.5 pr-1.5 pl-0 group-hover/row:bg-muted")} />
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

// A grouping shown as a column: the groups the paper is in, by name
function GroupsCell({ column, row }: { column: ThreadColumn; row: ThreadRowRead }) {
  const names = (row.in?.[column.id] ?? []).map((id) => column.groups?.find((g) => g.id === id)?.name).filter(Boolean)
  return <span className="text-foreground">{names.join(" · ")}</span>
}

// A cell: Owlit's answer, in ink like the short list's, ending in its page when it came from the full text.
// A comparison says how the paper stands and why, Owlit's reason being what the user doesn't know yet; their
// own sentence is one muted line under it only where nothing else says which one. It opens to the words it
// rests on.
// reread: the dot's change is Owlit answering again from the full text: the page's place says so while the
// dot lasts, and the card keeps the answer it replaced after.
function Cell({ thread, row, column, cell, fresh, reread, showSentence, libraryId }: { thread: ThreadRead; row: ThreadRowRead; column: ThreadColumn; cell: ThreadCell | undefined; fresh: boolean; reread: ReturnType<typeof readInFull>; showSentence: boolean; libraryId?: string }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const item = itemId.cell(row.id, column.id)
  const was = useReadInFull(thread.id, item, open)
  if (!cell) return <span className="text-muted-foreground/60">…</span>
  const sentence = column.sentences?.find((s) => s.id === cell.sentence)
  const text = cell.text
  const page = cell.depth === "full" && cell.passage ? cell.passage.page : undefined
  // No bearing on any of the user's sentences: nothing to say
  if (column.kind === "compare" && !cell.rel) return <span title={cell.text} />
  // The words wrap in a narrow column; the page stays on one line, as it does alone
  const pageMark =
    fresh && reread ? (
      <span className="ml-1 text-owlit">
        {t({ message: "Changed after reading in full", comment: "chip on a thread cell Owlit answered again from the full text" })}
        {page && <span className="whitespace-nowrap tabular-nums"> · {t({ message: `p. ${page}`, comment: "a page of a paper" })}</span>}
      </span>
    ) : (
      page && <span className="ml-1 whitespace-nowrap text-muted-foreground tabular-nums">{t({ message: `p. ${page}`, comment: "a page of a paper" })}</span>
    )
  const body =
    column.kind === "compare" && cell.rel ? (
      <>
        <span className={cn("font-medium", cell.rel === "related" ? "font-normal text-muted-foreground" : "text-foreground")}>{relWord(cell.rel)}</span>
        {text && <span className="text-foreground"> · {text}</span>}
        {pageMark}
        {showSentence && sentence && <span className="block truncate text-muted-foreground">“{sentence.text}”</span>}
      </>
    ) : (
      <span className="text-foreground">
        {text}
        {pageMark}
      </span>
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("-mx-1 -my-0.5 block w-full rounded-md px-1 py-0.5 text-left outline-none hover:bg-accent focus-key:bg-accent data-[state=open]:bg-accent", "line-clamp-4")}>
          {fresh && <NoteDot className="mr-1.5 mb-px align-middle" />}
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn(citationCardSurface, "w-96")}>
        <p className="text-detail text-muted-foreground">{columnLabel(column)}</p>
        {/* An answer from the title only is thin: muted, as the short list's peek draws it */}
        <p className={cn("mt-1 text-sm leading-relaxed", cell.depth === "title" && "text-muted-foreground")}>
          {column.kind === "compare" && cell.rel && <span className="mr-1 font-medium">{relWord(cell.rel)}:</span>}
          {text}
        </p>
        <WasLine was={was === undefined ? reread : was} className="mt-1" />
        {column.kind === "compare" && sentence && <Quote className="mt-2">“{sentence.text}”</Quote>}
        {/* What the answer rests on, as every citation's card says it, then the row that changes it */}
        <div className="mt-3 border-t pt-2.5">
          <CitationCard
            citation={{ paperId: row.id, depth: cell.depth, ...(cell.passage ? { page: cell.passage.page, quote: cell.passage.quote } : {}) }}
            footer={
              <div className="mt-2.5 flex items-center gap-2 border-t pt-2 text-detail text-muted-foreground">
                <span className="flex-1" />
                {cell.passage && libraryId && (
                  <MentionToken label={t`Open at p. ${cell.passage.page}`} onClick={() => navigate(passageRoute(libraryId, cell.passage))} />
                )}
              </div>
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

