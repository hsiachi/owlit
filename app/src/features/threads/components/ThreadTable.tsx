import { plural, t } from "@lingui/core/macro"
import { isTaskFinished, itemId, QUESTION_COLUMN, type Thread, type ThreadCell, type ThreadColumn, type ThreadGroup, type ThreadRow, type Relation } from "@owlit/protocol"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { Fragment, useState } from "react"
import { useNavigate } from "react-router-dom"
import { RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { ChoiceMenu } from "@/components/choice-menu"
import { NoteDot } from "@/components/marks"
import { MentionToken } from "@/components/mention/mention-token"
import { Quote } from "@/components/quote"
import { RenameInput } from "@/components/rename-input"
import { HeadCell, TablePeekRow, tablePeekCard } from "@/components/ruled-table"
import { SentenceEditor } from "@/components/sentence-editor"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { displayName } from "@/features/docs/types"
import { tasksFor, useTasksStore } from "@/features/tasks/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError, toastUndo } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { citeOf, columnLabel, paperFacts, passageRoute, relWord, useLibraryPaper } from "../lib"
import { editThread, put } from "../store"
import { ReadingMark, RowPeek } from "./AnswerRows"
import { useThreadsUi } from "../ui-store"
import { AskEach } from "./Work"

// A thread with columns, as a ruled table like the Library's: a row per paper, a column per question
// asked of every paper, the user's comparison with a doc as a column of plain words. Groups are Owlit's and
// fold; a row opens its card under it; a cell opens to show the words it rests on, and can be rewritten.

// Rows a group shows before "Show N more"
const SHOWN = 8

type GroupBy = "topic" | "none" | `column:${string}`

interface Section {
  key: string
  group?: ThreadGroup
  // A sentence of the user's, when grouped by a comparison
  sentence?: { id: string; text: string }
  label: string
  one?: string
  rows: ThreadRow[]
  // Its rows and its subgroups' rows, which its counts cover
  total: ThreadRow[]
  depth: number
}

function relCounts(rows: ThreadRow[], column: ThreadColumn | undefined) {
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

export function ThreadTable({ thread, shown, seenBefore }: { thread: Thread; shown: Thread; seenBefore: number }) {
  const columns = shown.columns.filter((c) => !c.hidden)
  const compare = columns.find((c) => c.kind === "compare")
  const [groupBy, setGroupBy] = useState<GroupBy>(shown.groups.length ? "topic" : "none")
  const [sort, setSort] = useState<string>("order")
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [all, setAll] = useState<Set<string>>(new Set())
  const [peek, setPeek] = useState<string | null>(null)
  // A row asked for from elsewhere (a link to one of its papers) opens where it first appears
  const asked = useThreadsUi((s) => s.peek)
  const isOpen = (key: string, rowId: string) => peek === key || (peek === null && asked === rowId)

  const sortRows = (rows: ThreadRow[]) => {
    if (sort === "title") return [...rows].sort((a, b) => a.paper.title.localeCompare(b.paper.title))
    if (sort === "year") return [...rows].sort((a, b) => (b.paper.year ?? 0) - (a.paper.year ?? 0))
    if (sort.startsWith("column:")) {
      const col = sort.slice(7)
      // What cuts against the user's sentences first: the papers most worth a look
      const order: Record<Relation, number> = { challenges: 0, supports: 1, related: 2 }
      const rank = (r: ThreadRow) => {
        const rel = r.cells[col]?.rel
        return rel ? order[rel] : 3
      }
      return [...rows].sort((a, b) => rank(a) - rank(b))
    }
    return rows
  }

  const sections: Section[] = []
  if (groupBy === "topic" && shown.groups.length) {
    const add = (g: ThreadGroup, depth: number) => {
      const own = shown.rows.filter((r) => r.group === g.id)
      const children = shown.groups.filter((c) => c.parent === g.id)
      const total = [...own, ...children.flatMap((c) => shown.rows.filter((r) => r.group === c.id))]
      // A group whose papers all went elsewhere says nothing
      if (!total.length) return
      sections.push({ key: g.id, group: g, label: g.name, one: g.one, rows: own, total, depth })
      for (const c of children) add(c, depth + 1)
    }
    for (const g of shown.groups.filter((g) => !g.parent)) add(g, 0)
    const loose = shown.rows.filter((r) => !r.group || !shown.groups.some((g) => g.id === r.group))
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

  const span = columns.length + 2
  const groupOptions = [
    ...(shown.groups.length ? [{ value: "topic" as GroupBy, label: t({ message: "Topic", comment: "group a thread's papers by Owlit's groups" }) }] : []),
    ...columns.filter((c) => c.kind === "compare").map((c) => ({ value: `column:${c.id}` as GroupBy, label: t`Sentences of ${displayName(c.doc ?? c.question)}` })),
    { value: "none" as GroupBy, label: t({ message: "None", comment: "no grouping" }) },
  ]
  return (
    <div className="mt-8">
      <div className="mb-2 -ml-2 flex flex-wrap items-center gap-1">
        {groupOptions.length > 1 && <ChoiceMenu value={groupBy} onChange={setGroupBy} label={t`Group by`} trigger={<GroupWord label={t`Group by`} value={groupOptions.find((o) => o.value === groupBy)?.label} />} align="start" options={groupOptions} />}
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
      <table className="w-full table-fixed border-separate border-spacing-0">
        <colgroup>
          <col style={{ width: columns.length > 2 ? "28%" : "36%" }} />
          {columns.map((c) => (
            <col key={c.id} />
          ))}
          <col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr>
            <HeadCell first>{t`Paper`}</HeadCell>
            {columns.map((c) => (
              <HeadCell key={c.id}>
                <ColumnHeader thread={thread} column={c} />
              </HeadCell>
            ))}
            <HeadCell last>
              <AskEach thread={thread} trigger="plus" />
            </HeadCell>
          </tr>
        </thead>
        <tbody>
          {sections.map((s) => {
            const open = !folded.has(s.key)
            const rows = sortRows(s.rows)
            const many = rows.length > SHOWN && !all.has(s.key)
            return (
              <Fragment key={`${s.key}:${s.depth}`}>
                {s.label && (
                  <GroupRow
                    thread={thread}
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
                        columns={columns}
                        // Grouped by a comparison's sentences, the group says which sentence; one sentence
                        // needs no saying
                        sentenceShown={(c) => groupBy !== `column:${c.id}` && (c.sentences?.length ?? 0) > 1}
                        indent={s.label ? s.depth + 1 : 0}
                        seenBefore={seenBefore}
                        open={isOpen(`${s.key}:${r.id}`, r.id)}
                        onOpen={() => {
                          useThreadsUi.getState().set({ peek: null })
                          setPeek(isOpen(`${s.key}:${r.id}`, r.id) ? "" : `${s.key}:${r.id}`)
                        }}
                      />
                      <PeekRow thread={thread} row={r} open={isOpen(`${s.key}:${r.id}`, r.id)} span={span} />
                    </Fragment>
                  ))}
                {open && many && (
                  <tr>
                    <td colSpan={span} className="border-b py-1.5" style={{ paddingLeft: 10 + (s.label ? (s.depth + 1) * 20 : 0) }}>
                      <Button variant="text" size="inline" onClick={() => setAll((a) => new Set(a).add(s.key))}>
                        <ChevronDownIcon />
                        {plural(rows.length - SHOWN, { one: "# more", other: "# more" })}
                      </Button>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
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

// A column's name, with what can be done to it; while Owlit fills it, how far it got
function ColumnHeader({ thread, column }: { thread: Thread; column: ThreadColumn }) {
  const filling = useTasksStore((s) => tasksFor(s.byId, `${thread.id}:${column.id}`).some((task) => task.kind === "threads.fill" && !isTaskFinished(task)))
  const done = thread.rows.filter((r) => r.cells[column.id] && !thread.yours.removed[itemId.row(r.id)]).length
  const of = thread.rows.filter((r) => !thread.yours.removed[itemId.row(r.id)]).length
  const label = columnLabel(column)
  const progress = filling && <span className="shimmer ml-1.5 font-normal tabular-nums">{t`${done} of ${of}`}</span>
  if (column.id === QUESTION_COLUMN)
    return (
      <span className="flex items-center" title={column.question}>
        <span className="truncate">{label}</span>
        {progress}
      </span>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={column.kind === "compare" ? column.sentences?.map((s) => s.text).join("\n") : column.question} className="group/h -mx-1.5 flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 outline-none hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground">
          <span className="truncate">{label}</span>
          {progress}
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-0 group-hover/h:opacity-100 group-data-[state=open]/h:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onSelect={() => void askAgain(thread.id, column.id)}>{t`Ask again`}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void editThread(thread.id, { op: "hide", column: column.id, hidden: true })}>{t`Hide column`}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Fills what the column still lacks; the answers there stay, and the user's own stay whatever happens
async function askAgain(id: string, column: string) {
  if (!isDesktop) return
  await rpc.threads.fill({ id, column }).catch(toastError)
}

function GroupRow({ thread, section, open, span, count, rels, onToggle }: { thread: Thread; section: Section; open: boolean; span: number; count: string; rels: string; onToggle: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const navigate = useNavigate()
  const g = section.group
  const groups: MenuGroups = g
    ? [
        [
          { label: t`Rename`, onSelect: () => setRenaming(true), afterClose: true },
          {
            label: t`Merge into`,
            childrenClassName: "w-56",
            children: thread.groups.filter((o) => o.id !== g.id).map((o) => ({ label: o.name, onSelect: () => void editThread(thread.id, { op: "merge", group: g.id, into: o.id }) })),
          },
          { label: t`Ungroup`, onSelect: () => void editThread(thread.id, { op: "ungroup", group: g.id }) },
        ],
        [
          {
            label: t`Make it a thread of its own`,
            onSelect: async () => {
              if (!isDesktop) return
              const rows = thread.rows.filter((r) => r.group === g.id || thread.groups.some((c) => c.parent === g.id && c.id === r.group)).map((r) => r.id)
              try {
                const c = await rpc.threads.split({ id: thread.id, rows, asked: section.label })
                put(c)
                navigate(`/threads/${c.id}`)
                toastUndo(t`Made a thread of its own`, async () => {
                  const from = await rpc.threads.unsplit({ id: c.id }).catch(toastError)
                  if (!from) return
                  put(from)
                  navigate(`/threads/${from.id}`)
                })
              } catch (error) {
                toastError(error)
              }
            },
          },
        ],
      ]
    : []
  return (
    <tr className="group/row">
      <td colSpan={span} className="border-b pt-4 pb-1.5" style={{ paddingLeft: 6 + section.depth * 20 }}>
        <div className="flex items-center gap-2">
          {renaming && g ? (
            <RenameInput
              initial={section.label}
              label={t`Group name`}
              onDone={(name) => {
                if (name !== null) void editThread(thread.id, { op: "rewrite", item: itemId.group(g.id), text: name })
                setRenaming(false)
              }}
              className="h-7 max-w-sm px-2"
            />
          ) : (
            <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left outline-none hover:bg-muted focus-key:bg-muted">
              <ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--t-layout)", open && "rotate-90")} />
              <span className={cn("text-sm", section.depth === 0 ? "font-medium" : "", section.sentence && "font-normal")}>{section.label}</span>
            </button>
          )}
          {section.one && <span className="min-w-0 truncate text-detail text-muted-foreground">{section.one}</span>}
          <span className="ml-auto shrink-0 text-detail text-muted-foreground tabular-nums">{[count, rels].filter(Boolean).join(" · ")}</span>
          {/* The ⋯ holds its place while hidden, and a section without one keeps the same room, so the counts
              stay put on hover and line up from row to row */}
          {g ? <RowMenuButton groups={groups} label={t`Group actions`} menuClassName="w-56" keepSpace /> : <span className="size-6 shrink-0" />}
        </div>
      </td>
    </tr>
  )
}

function TableRow({ thread, row, columns, sentenceShown, indent, seenBefore, open, onOpen }: { thread: Thread; row: ThreadRow; columns: ThreadColumn[]; sentenceShown: (column: ThreadColumn) => boolean; indent: number; seenBefore: number; open: boolean; onOpen: () => void }) {
  const library = useLibraryPaper(row)
  const facts = paperFacts(row, library)
  const fresh = (thread.changedAt[itemId.row(row.id)] ?? 0) > seenBefore
  const td = cn("border-b px-2.5 py-2 align-top text-detail leading-5", open && "border-b-transparent")
  return (
    <tr id={`row-${row.id}`} className="group/row">
      <td className={cn(td, "cursor-default text-sm group-hover/row:bg-muted")} style={{ paddingLeft: 10 + indent * 20 }} onClick={onOpen}>
        <span className="flex items-start gap-2">
          <span className={cn(open ? "font-medium text-balance" : "line-clamp-2")}>{facts.title}</span>
          {/* Owlit's dot for a new row and the user's reading are two facts, so both can show */}
          <span className="flex h-5 shrink-0 items-center gap-1.5">
            {fresh && <NoteDot />}
            <ReadingMark paper={library} />
          </span>
        </span>
        <span className="block truncate text-detail text-muted-foreground">{citeOf(facts)}</span>
      </td>
      {columns.map((c) => (
        <td key={c.id} className={cn(td, "group-hover/row:bg-muted")}>
          <Cell thread={thread} row={row} column={c} cell={row.cells[c.id]} fresh={(thread.changedAt[itemId.cell(row.id, c.id)] ?? 0) > seenBefore} showSentence={sentenceShown(c)} libraryId={library?.id} />
        </td>
      ))}
      <td className={cn(td, "group-hover/row:bg-muted")} />
    </tr>
  )
}

function PeekRow({ thread, row, open, span }: { thread: Thread; row: ThreadRow; open: boolean; span: number }) {
  const library = useLibraryPaper(row)
  return (
    <TablePeekRow open={open} span={span}>
      <RowPeek thread={thread} row={row} library={library} className={tablePeekCard} />
    </TablePeekRow>
  )
}

// A cell: Owlit's answer, in ink like the short list's, ending in its page when it came from the full text.
// A comparison says how the paper stands and why, Owlit's reason being what the user doesn't know yet; their
// own sentence is one muted line under it only where nothing else says which one. It opens to the words it
// rests on, and to rewriting it; the user's words stay through every later answer.
function Cell({ thread, row, column, cell, fresh, showSentence, libraryId }: { thread: Thread; row: ThreadRow; column: ThreadColumn; cell: ThreadCell | undefined; fresh: boolean; showSentence: boolean; libraryId?: string }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const navigate = useNavigate()
  if (!cell) return <span className="text-muted-foreground/60">…</span>
  const item = itemId.cell(row.id, column.id)
  const edit = thread.yours.edits[item]
  const sentence = column.sentences?.find((s) => s.id === cell.sentence)
  const text = edit?.text ?? cell.text
  const page = cell.depth === "full" && cell.passage && !edit ? cell.passage.page : undefined
  // No bearing on any of the user's sentences: nothing to say
  if (column.kind === "compare" && !cell.rel && !edit) return <span title={cell.text} />
  const pageMark = page && <span className="ml-1 whitespace-nowrap text-muted-foreground tabular-nums">{t({ message: `p. ${page}`, comment: "a page of a paper" })}</span>
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
    <Popover open={open} onOpenChange={(o) => (setOpen(o), setEditing(false))}>
      <PopoverTrigger asChild>
        <button type="button" className={cn("-mx-1 -my-0.5 block w-full rounded-md px-1 py-0.5 text-left outline-none hover:bg-accent focus-key:bg-accent data-[state=open]:bg-accent", "line-clamp-4")}>
          {fresh && <NoteDot className="mr-1.5 mb-px align-middle" />}
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 gap-0 p-3">
        <p className="text-detail text-muted-foreground">
          {columnLabel(column)} · {citeOf(paperFacts(row, undefined))}
        </p>
        {editing ? (
          <div className="mt-2">
            <SentenceEditor
              value={edit?.text ?? cell.text}
              onCancel={() => setEditing(false)}
              onSave={(text) => {
                setEditing(false)
                void editThread(thread.id, { op: "rewrite", item, text })
              }}
            />
          </div>
        ) : (
          <p className="mt-1.5 text-sm leading-relaxed">
            {column.kind === "compare" && cell.rel && <span className="mr-1 font-medium">{relWord(cell.rel)}:</span>}
            {text}
          </p>
        )}
        {column.kind === "compare" && sentence && <Quote className="mt-2">“{sentence.text}”</Quote>}
        {cell.passage && (
          <Quote size="sm" className="mt-2.5">
            “{cell.passage.quote}”
          </Quote>
        )}
        <div className="mt-2.5 flex items-center gap-2 text-detail text-muted-foreground">
          <span>{edit ? t`You edited this` : cell.depth === "full" ? t`Owlit, from the full text` : t`Owlit, from the abstract`}</span>
          <span className="flex-1" />
          {!editing && (
            <Button variant="text" size="inline" onClick={() => setEditing(true)}>
              {t({ message: "Rewrite", comment: "verb: change the words of Owlit's sentence" })}
            </Button>
          )}
          {edit && (
            <Button variant="text" size="inline" title={t`Was: ${edit.was}`} onClick={() => void editThread(thread.id, { op: "revert", item })}>
              {t`Use Owlit's words`}
            </Button>
          )}
          {cell.passage && libraryId && (
            <MentionToken label={t`Open at p. ${cell.passage.page}`} onClick={() => navigate(passageRoute(libraryId, cell.passage))} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

