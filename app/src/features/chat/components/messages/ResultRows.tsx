import { plural, t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef, useState } from "react"
import { create } from "zustand"
import { type Change, type ChatMessage, editStats, type EditStats, type MemoryLine, type ReadFrom, RpcErrorCode } from "@owlit/protocol"
import { ArrowUpRightIcon, BookmarkIcon, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FoldChevron } from "@/components/fold"
import { Unfold } from "@/components/unfold"
import { KIND_ICON } from "@/lib/kinds"
import { useOpenFromChat } from "@/features/agent/hooks"
import { fileAt } from "@/features/docs/store"
import { useDigestRows } from "@/features/library/digest-rows"
import { paperById, useLibraryStore } from "@/features/library/store"
import { paperOfNotePath } from "@/features/library/notes/note-actions"
import { manageMemory } from "@/features/settings/memory"
import { useThreadsStore } from "@/features/threads/store"
import { labelOf, undoEntry, useChatChanges } from "../../results"
import { countParts } from "../../lib/edit-counts"
import { partsUndone, replyEntries, undoneBy } from "../../lib/reply-changes"
import { useChatStore } from "../../store"
import { toastLeft } from "@/lib/changes"
import { isDesktop, rpc, RpcError } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { toast } from "sonner"
import { capital, joinActions } from "@/lib/words"

// Under an answer, one card listing what the reply changed outside the chat: docs edited, papers added,
// comments left, papers gathered into a thread, digests asked for (followed until written), lines Owlit now
// keeps in mind. A row goes to what it names, in the main view rather than opening
// anything in place, so its mark is a go-to arrow, and only on hover: at rest every row looks the same,
// whether or not it has somewhere to go. Undo shows on hover too, since it's rarely wanted and a column
// of Undo buttons reads as a form to fill in. Rows sit tight: nothing in the card stays selected. Several comments or edits on one doc are one
// row, so a long turn's card stays a few lines; past FOLD_AFTER rows the rest wait behind "Show N more".
export interface ResultRow {
  key: string
  icon: LucideIcon
  name: string
  // At the right: "+31 −1" for an edit, "Added" for a paper, "3 comments"
  detail?: React.ReactNode
  undone: boolean
  view?: () => void
  undo?: () => Promise<void> | void
  // On an undone row, when the change can be put back
  redo?: () => Promise<void> | void
  // For the summary line: what kind of change, and how much an edit changed
  kind: "doc" | "paper" | "comment" | "digest" | "thread" | "memory"
  // A thread: whether the reply started it, and how many papers it gathered
  created?: boolean
  papers?: number
  stats?: EditStats
  // An edited file that is one of the user's Markdown docs
  markdown?: boolean
  // A paper the agent took back out of the library
  removed?: boolean
}

const FOLD_AFTER = 3

// What the reply's edits to a file amounted to. Core reads it from its change log, which is the whole
// change whatever the agent reported; without core (the browser preview) the reply's own diffs are summed.
const statsCache = create<{ byKey: Record<string, (EditStats & { passages?: number }) | null>; load: (from: string, to: string) => void }>()((set, get) => ({
  byKey: {},
  load: (from, to) => {
    const key = `${from}|${to}`
    if (key in get().byKey) return
    set((s) => ({ byKey: { ...s.byKey, [key]: null } }))
    void rpc.changes
      .stats({ ids: [from, to] })
      .then((stats) => set((s) => ({ byKey: { ...s.byKey, [key]: stats } })))
      .catch(() => undefined)
  },
}))

function statsFromParts(parts: ChatMessage["parts"], path: string): EditStats | undefined {
  const edits = parts.filter((p) => p.type === "tool_call" && p.status === "completed" && !!p.diff && (p.diff.path === path || p.diff.path.endsWith(`/${path}`)))
  const all = edits.map((p) => (p.type === "tool_call" && p.diff ? editStats(path, p.diff.oldText ?? "", p.diff.newText) : null)).filter((s) => s !== null)
  if (!all.length) return undefined
  // Only a lone Write carries the whole file, so only it can tell that most of the doc went
  const whole = edits.length === 1 && edits[0].type === "tool_call" && edits[0].tool?.name === "Write"
  return { unit: all[0].unit, added: all.reduce((t, s) => t + s.added, 0), removed: all.reduce((t, s) => t + s.removed, 0), rewritten: whole && all[0].rewritten }
}

// "+31 −1": new words in Owlit's green, as the doc marks its edits; removals muted, never red.
// A doc mostly replaced says "Rewritten" instead of two large numbers. Lines say their unit.
function EditCounts({ stats }: { stats: EditStats }) {
  if (stats.rewritten) return <span>{t({ message: "Rewritten", comment: "a doc an edit mostly replaced" })}</span>
  const { added, removed, unit } = countParts(stats)
  return (
    <span className="tabular-nums" title={stats.unit === "words" ? t`Words added and removed` : t`Lines added and removed`}>
      {added && <span className="text-owlit">{added}</span>}
      {added && removed && " "}
      {removed && <span>{removed}</span>}
      {unit && ` ${unit}`}
    </span>
  )
}

// Takes entries back one at a time, in the order given (newest first, so each finds things as the next
// one left them), as one Undo. An entry that changed since is passed over and the others still go back: a
// doc's passages edited since stay as they are, and so do a thread's items a later write changed; a toast
// names them.
async function undoAll(list: Change[], name: string) {
  const left: string[] = []
  const kept: string[] = []
  for (const c of list) {
    try {
      left.push(...((await undoEntry(c)) ?? []))
    } catch (error) {
      if (!(error instanceof RpcError) || (error.code !== RpcErrorCode.Conflict && error.code !== RpcErrorCode.NotFound)) return toastError(error)
      if (c.target.kind === "thread") kept.push(threadItemLabel(c))
      else toastError(error)
    }
  }
  if (left.length) toastLeft(name, left)
  if (kept.length) toast(t({ message: "Some of it changed since and stays as it is", comment: "after undoing Owlit's write to a thread" }), { description: `${name}: ${[...new Set(kept)].join(", ")}` })
}

// A thread's item as the person knows it: a paper by its title, the report, a group by its name
function threadItemLabel(c: Change): string {
  const [kind, a, b] = (c.target.part ?? "").split(":")
  const thread = useThreadsStore.getState().threads[c.target.path]
  if (kind === "row" || kind === "cell") return thread?.rows.find((r) => r.id === a)?.paper.title ?? a
  if (kind === "group") return thread?.columns.find((col) => col.id === a)?.groups?.find((g) => g.id === b)?.name ?? b
  if (kind === "report" || kind === "one") return t({ message: "the report", comment: "Owlit's report at the top of a thread" })
  return t({ message: "the thread's details", comment: "a part of a thread other than a paper, a group or the report" })
}

const EMPTY_MESSAGES: ChatMessage[] = []

function useResultRows(message: ChatMessage, chatId: string): ResultRow[] {
  const navigate = useOpenFromChat()
  const all = useChatChanges(chatId)
  const messages = useChatStore((s) => s.chats[chatId]?.messages) ?? EMPTY_MESSAGES
  const library = useLibraryStore((s) => s.papers)
  const threads = useThreadsStore((s) => s.threads)
  const entries = useMemo(() => replyEntries(all, messages, message.id), [all, messages, message.id])
  const stats = statsCache((s) => s.byKey)
  const byKind = (kind: Change["target"]["kind"]) => {
    const map = new Map<string, Change[]>()
    for (const c of entries) if (c.target.kind === kind) map.set(c.target.path, [...(map.get(c.target.path) ?? []), c])
    return map
  }
  const docs = byKind("doc")
  // Each doc's first and last change from this reply, whose stats core is asked for once
  const spans = isDesktop ? [...docs].map(([path, list]) => ({ path, key: `${list[0].id}|${list.at(-1)!.id}`, from: list[0].id, to: list.at(-1)!.id })) : []
  const wanted = spans.map((s) => s.key).join(",")
  useEffect(() => {
    for (const s of spans) statsCache.getState().load(s.from, s.to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])
  const openDoc = (path: string) => {
    const file = fileAt(path)
    return file ? () => navigate(`/docs/${file.id}`) : undefined
  }
  // A row's entries: undone once each is, Undo takes back the live ones and Redo the undos, newest first.
  // A doc's passages undone one by one in the doc (`passages`: how many the row's edit has) count too: all
  // of them, and the row is undone; some, and Undo is for what is left.
  const of = (list: Change[], name: string, passages?: number) => {
    const parts = list.flatMap((c) => (undoneBy(c.id, all) ? [] : partsUndone(c.id, all)))
    const allParts = !!passages && parts.length >= passages
    const live = allParts ? [] : list.filter((c) => !undoneBy(c.id, all)).reverse()
    const undos = [...list.map((c) => undoneBy(c.id, all)).filter((c) => c !== undefined), ...(allParts ? parts : [])].sort((a, b) => b.at - a.at)
    return {
      undone: !live.length,
      undo: () => undoAll(live, name),
      ...(!live.length ? { redo: () => undoAll(undos, name) } : {}),
      ...(parts.length && !allParts ? { partly: passages ? t`${parts.length} of ${passages} passages undone` : plural(parts.length, { one: "# passage undone", other: "# passages undone" }) } : {}),
    }
  }
  const rows: ResultRow[] = []
  // A doc moved or renamed is its old path deleted and its new one created in one write: one row, at the
  // new path, whose Undo takes both back
  const movedFrom = new Map<string, string>()
  for (const [path, list] of docs) {
    const create = list.find((c) => c.action === "create")
    const from = create && [...docs].find(([other, l]) => other !== path && l.some((c) => c.action === "delete" && c.origin.writeId === create.origin.writeId))
    if (from) movedFrom.set(path, from[0])
  }
  for (const [path, list] of docs) {
    if ([...movedFrom.values()].includes(path)) continue
    const from = movedFrom.get(path)
    const entries = from ? [...list, ...(docs.get(from) ?? [])] : list
    const deleted = !from && list.every((c) => c.action === "delete")
    const span = spans.find((s) => s.path === path)
    const edit = span ? (stats[span.key] ?? undefined) : statsFromParts(message.parts, path)
    // A paper's note is the user's own text, named by its paper and opened on the paper's page
    const notePaper = paperOfNotePath(path)
    const paper = labelOf(path)
    const name = notePaper ? t`Your note on ${paper}` : paper
    const { partly, ...state } = of(entries, name, from || deleted ? undefined : (edit as { passages?: number } | undefined)?.passages)
    rows.push({
      key: `file:${path}`,
      kind: "doc",
      icon: notePaper ? KIND_ICON.paper : KIND_ICON.doc,
      name,
      detail: from
        ? t({ message: `Moved from ${from}`, comment: "a doc the agent moved or renamed; its old path" })
        : deleted
          ? t({ message: "Deleted", comment: "a doc the agent deleted, into the Trash" })
          : (partly ?? (edit ? <EditCounts stats={edit} /> : undefined)),
      stats: from || deleted || partly ? undefined : edit,
      markdown: /\.(md|markdown)$/i.test(path),
      ...state,
      view: notePaper ? () => navigate(`/library/${notePaper}`) : deleted ? undefined : openDoc(path),
    })
  }
  for (const [path, list] of byKind("comment")) {
    const name = labelOf(path)
    const count = list.filter((c) => c.action === "create" && !c.target.part?.includes("/")).length
    rows.push({ key: `comment:${path}`, kind: "comment", icon: KIND_ICON.comment, name, detail: plural(count, { one: "# comment", other: "# comments" }), ...of(list, name), view: openDoc(path) })
  }
  // Threads the reply gathered papers into, one row each however many writes it took
  for (const [id, list] of byKind("thread")) {
    const thread = threads[id]
    const created = list.some((c) => !c.target.part && c.action === "create")
    const item = (c: Change, kind: string) => (c.target.part?.startsWith(`${kind}:`) ? c.target.part.split(":")[1] : undefined)
    const rowIds = [...new Set(list.filter((c) => c.action === "create").map((c) => item(c, "row")).filter((r) => r !== undefined))]
    const papers = rowIds.length
    const updated = new Set(list.map((c) => item(c, "cell")).filter((r) => r !== undefined && !rowIds.includes(r))).size
    const answers = updated ? plural(updated, { one: "# answer updated", other: "# answers updated" }) : undefined
    const name = thread ? thread.title : id
    rows.push({
      key: `thread:${id}`,
      kind: "thread",
      icon: KIND_ICON.thread,
      name,
      created,
      papers,
      detail: created ? (
        // "New thread" is said by the row's icon too, so a narrow card keeps only "New"
        <>
          <span className="hidden @md:inline">{plural(papers, { one: "New thread · # paper", other: "New thread · # papers" })}</span>
          <span className="@md:hidden">{plural(papers, { one: "New · # paper", other: "New · # papers" })}</span>
        </>
      ) : papers ? (
        <span className="tabular-nums">
          <span className="text-owlit">+{papers}</span> {plural(papers, { one: "paper", other: "papers" })}
          {answers && ` · ${answers}`}
        </span>
      ) : (
        (answers ?? t({ message: "Updated", comment: "a thread the agent changed without adding papers" }))
      ),
      ...of(list, name),
      view: () => navigate(`/threads/${id}`),
    })
  }
  // Edits to the user's own docs first: they matter most and must not fold away behind papers
  for (const c of entries.filter((c) => c.target.kind === "paper")) {
    const name = library[c.target.path]?.title ?? c.target.path
    // A digest the agent wrote with library_write_digest (asked-for ones are useDigestRows')
    if (c.target.part === "digest") {
      rows.push({ key: `${WROTE_DIGEST}${c.id}`, kind: "digest", icon: KIND_ICON.paper, name, detail: t({ message: "Wrote its digest", comment: "the agent wrote or rewrote a paper's digest" }), ...of([c], name), view: () => navigate(`/library/${c.target.path}`) })
      continue
    }
    const removed = c.action === "delete"
    // A paper the agent took back has nothing to open; Undo puts it back
    const view = removed ? undefined : () => navigate(`/library/${c.target.path}`)
    rows.push({ key: `paper:${c.id}`, kind: "paper", icon: KIND_ICON.paper, name, detail: removed ? t({ message: "Removed", comment: "a paper the agent took out of the library" }) : t({ message: "Added", comment: "a paper the agent added to the library" }), ...of([c], name), view, removed })
  }
  // Lines Owlit now keeps in mind, in its words; the row opens the list (Settings › Owlit › Manage…)
  for (const c of entries.filter((c) => c.target.kind === "memory")) {
    const removed = c.action === "delete"
    const name = ((c.after ?? c.before) as MemoryLine | undefined)?.text ?? ""
    rows.push({
      key: `memory:${c.id}`,
      kind: "memory",
      icon: BookmarkIcon,
      name,
      detail: removed
        ? t({ message: "Removed", comment: "a line the agent took out of what it keeps in mind" })
        : c.action === "update"
          ? t({ message: "Updated", comment: "a line the agent changed in what it keeps in mind" })
          : t({ message: "Remembered", comment: "a line the agent now keeps in mind" }),
      ...of([c], name),
      view: () => manageMemory(true),
      removed,
    })
  }
  return rows
}

// The key a row for a digest the agent wrote starts with, apart from the digests it asked for
const WROTE_DIGEST = "wrote-digest:"
const wrote = (rows: ResultRow[]) => rows.filter((r) => r.kind === "digest" && r.key.startsWith(WROTE_DIGEST)).length
const added = (rows: ResultRow[]) => rows.filter((r) => r.kind === "paper" && !r.removed).length
const removed = (rows: ResultRow[]) => rows.filter((r) => r.kind === "paper" && r.removed).length
const started = (rows: ResultRow[]) => rows.filter((r) => r.kind === "thread" && r.created).length
const gathered = (rows: ResultRow[]) => rows.filter((r) => r.kind === "thread" && !r.created).reduce((n, r) => n + (r.papers ?? 0), 0)

// "Edited 2 docs and added 3 papers"
function summary(rows: ResultRow[]) {
  const n = (kind: ResultRow["kind"]) => rows.filter((r) => r.kind === kind).length
  const docs = n("doc")
  const markdown = rows.filter((r) => r.kind === "doc").every((r) => r.markdown)
  const said = [
    // A doc is a Markdown file of the user's; a script or a paper's .tex is a file
    docs && (markdown ? plural(docs, { one: "edited a doc", other: "edited # docs" }) : plural(docs, { one: "edited a file", other: "edited # files" })),
    added(rows) && plural(added(rows), { one: "added a paper", other: "added # papers" }),
    removed(rows) && plural(removed(rows), { one: "removed a paper", other: "removed # papers" }),
    n("comment") && plural(n("comment"), { one: "left comments on a doc", other: "left comments on # docs" }),
    started(rows) && plural(started(rows), { one: "started a thread", other: "started # threads" }),
    gathered(rows) && plural(gathered(rows), { one: "added a paper to a thread", other: "added # papers to threads" }),
    wrote(rows) && plural(wrote(rows), { one: "wrote a digest", other: "wrote # digests" }),
    n("digest") - wrote(rows) && plural(n("digest") - wrote(rows), { one: "asked for a digest", other: "asked for # digests" }),
    n("memory") && plural(n("memory"), { one: "changed what it keeps in mind", other: "changed # lines it keeps in mind" }),
  ].filter(Boolean) as string[]
  return capital(joinActions(said))
}

const SHOW_ON_HOVER = "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
// The buttons a row offers on hover take no width at rest: in a narrow panel, an invisible Undo beside the
// detail would squeeze the name down to a character or two. Still in the tab order, so focus shows them.
const HOVER_ONLY =
  "flex shrink-0 max-w-0 -mr-1.5 items-center gap-1.5 overflow-hidden opacity-0 group-hover/row:mr-0 group-hover/row:max-w-none group-hover/row:opacity-100 group-focus-within/row:mr-0 group-focus-within/row:max-w-none group-focus-within/row:opacity-100"

// Undo draws the strike across the name from the left (the `strike` rule in index.css), then the row settles
// into the muted tone; done at once, it would look like a different row had replaced it. Redo takes the
// strike back the way it came and the row is live again.
function Row({ row, className }: { row: ResultRow; className?: string }) {
  const Icon = row.icon
  const live = !row.undone
  const name = row.name
  return (
    <div className={`group/row relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm ${row.view && live ? "hover:bg-muted" : ""} ${className ?? ""}`}>
      {/* The whole row opens what it names; Undo sits above that click */}
      {row.view && live && <button type="button" onClick={row.view} aria-label={t`Open ${name}`} className="absolute inset-0 rounded-md outline-none focus-key:bg-muted" />}
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      {/* In a narrow panel the detail gives way once the name is down to 40% of the row, so neither is cut
          to nothing. The strike is drawn across the words only, not the room the name is given. */}
      <span className="flex min-w-[40%] flex-1">
        <span
          data-struck={live ? undefined : ""}
          className={`strike w-fit max-w-full truncate transition-colors duration-(--t-mark) ease-(--ease) ${live ? "text-foreground" : "text-muted-foreground"}`}
        >
          {row.name}
        </span>
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-detail text-muted-foreground">
        <span className={HOVER_ONLY}>
          {live && row.undo && (
            <Button variant="text" size="inline" onClick={() => void row.undo!()} className="relative">
              {t({ message: "Undo", comment: "verb: take back a change the agent made" })}
            </Button>
          )}
          {!live && row.redo && (
            <Button variant="text" size="inline" onClick={() => void row.redo!()} className="relative">
              {t({ message: "Redo", comment: "verb: put back a change that was undone" })}
            </Button>
          )}
        </span>
        <span className="min-w-0 truncate">{live ? row.detail : t({ message: "Undone", comment: "a change that was taken back" })}</span>
        <ArrowUpRightIcon className={`size-3.5 shrink-0 ${row.view && live ? SHOW_ON_HOVER : "invisible"}`} />
      </span>
    </div>
  )
}

export function ResultCard({ message, chatId }: { message: ChatMessage; chatId: string }) {
  const rows = [...useResultRows(message, chatId), ...useDigestRows(message.parts)]
  const [all, setAll] = useState(false)
  const built = message.readFrom ?? []
  if (!rows.length && !built.length) return null
  const live = rows.filter((r) => !r.undone && r.undo)
  const changes = rows.length
  // The total counts in one unit only: words when every edit was to prose
  const edits = rows.flatMap((r) => (r.stats && !r.undone ? [r.stats] : []))
  const total: EditStats | undefined =
    edits.length > 1 && edits.every((e) => e.unit === edits[0].unit)
      ? { unit: edits[0].unit, added: edits.reduce((t, e) => t + e.added, 0), removed: edits.reduce((t, e) => t + e.removed, 0), rewritten: false }
      : undefined
  // The rest unfold above the "Show N more" line, which stays as "Show less" to fold them back
  const rest = rows.length > FOLD_AFTER + 1 ? rows.slice(FOLD_AFTER) : []
  return (
    <div className="@container flex flex-col rounded-lg border p-1">
      {built.length > 0 && <BuiltFrom readFrom={built} />}
      {/* One change says itself; several get a line saying what happened, with Undo for all of them */}
      {rows.length > 1 && (
        // A sentence, which a narrow card shortens to a count: the rows under it say the rest
        <div className="group/row flex min-h-8 items-center gap-2.5 px-2.5 py-1.5 text-sm">
          <span className="min-w-0 text-foreground">
            <span className="hidden @md:inline">{summary(rows)}</span>
            <span className="@md:hidden">{plural(changes, { one: "# change", other: "# changes" })}</span>
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-detail text-muted-foreground">
            {live.length > 1 && (
              <span className={HOVER_ONLY}>
                <Button variant="text" size="inline" onClick={() => void live.reduce((done, r) => done.then(() => r.undo!()), Promise.resolve())}>
                  {t({ message: "Undo all", comment: "verb: take back every change of the reply" })}
                </Button>
              </span>
            )}
            {total && (total.added > 0 || total.removed > 0) && <EditCounts stats={total} />}
            <ArrowUpRightIcon className="invisible size-3.5" />
          </span>
        </div>
      )}
      {rows.slice(0, rest.length ? FOLD_AFTER : undefined).map((row) => (
        <Row key={row.key} row={row} />
      ))}
      {rest.length > 0 && (
        <>
          <Unfold open={all}>
            {rest.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </Unfold>
          <button type="button" onClick={() => setAll((a) => !a)} className="flex h-8 w-full items-center rounded-md pr-2.5 pl-[38px] text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted">
            {all ? t`Show less` : plural(rest.length, { one: "Show # more", other: "Show # more" })}
          </button>
        </>
      )}
    </div>
  )
}

// What the answer was built from, as core saw the turn read. Closed, one line that says how many papers it
// knew only from their abstracts ("From 6 papers · 3 abstract only", or "all read"): the one fact that bears
// on how far to trust the answer, and short enough for the narrowest panel. A paper without a PDF counts
// as abstract only, one read from its digest as read. Open, each paper with how it was read. Resting on the
// count or a paper marks, in the answer above, the citations it stands for.
const PaperIcon = KIND_ICON.paper
const THIN: ReadFrom["depth"][] = ["abstract", "none"]
function BuiltFrom({ readFrom }: { readFrom: ReadFrom[] }) {
  const line = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const navigate = useOpenFromChat()
  const library = useLibraryStore((s) => s.papers)
  const aliases = useLibraryStore((s) => s.aliases)
  const papers = readFrom.length
  const thin = readFrom.filter((r) => THIN.includes(r.depth))
  const mark = (ids: string[] | null) => {
    const answer = line.current?.closest<HTMLElement>('[data-slot="message"]')
    if (!answer) return
    const want = new Set(ids ?? [])
    for (const el of answer.querySelectorAll<HTMLElement>("[data-paper]")) {
      // A citation may name the paper by an id it had before
      const id = paperById(library, aliases, el.dataset.paper!)?.id ?? el.dataset.paper!
      el.toggleAttribute("data-marked", want.has(id))
    }
  }
  const depthOf = (r: ReadFrom) => {
    if (r.depth === "full") return t({ message: "Read in full", context: "read depth", comment: "how Owlit read a paper an answer was built from" })
    if (r.depth === "digest") return t({ message: "From the digest", context: "read depth", comment: "how Owlit read a paper an answer was built from" })
    if (r.depth === "abstract") return t({ message: "Abstract only", context: "read depth", comment: "how Owlit read a paper an answer was built from" })
    if (r.depth === "none") return t({ message: "No PDF", context: "read depth", comment: "how Owlit read a paper an answer was built from: owlit has no text of it" })
    if (!r.pages) return t({ message: "Part of the text", context: "read depth", comment: "how Owlit read a paper an answer was built from: some of its pages or a section" })
    return /[–,]/.test(r.pages) ? t({ message: `pp. ${r.pages}`, context: "read depth", comment: "how Owlit read a paper an answer was built from: pages 4–5 of it" }) : t({ message: `p. ${r.pages}`, context: "read depth", comment: "how Owlit read a paper an answer was built from: page 4 of it" })
  }
  return (
    <div ref={line} className="text-sm text-muted-foreground" onPointerLeave={() => mark(null)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left outline-none hover:bg-muted focus-key:bg-muted"
      >
        <PaperIcon className="size-4 shrink-0" />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0">{plural(papers, { one: "From # paper", other: "From # papers" })}</span>
          <span aria-hidden>·</span>
          {thin.length ? (
            <span className="truncate rounded-sm hover:text-foreground" onPointerEnter={() => mark(thin.map((r) => r.paperId))} onPointerLeave={() => mark(null)}>
              {plural(thin.length, { one: "# abstract only", other: "# abstract only" })}
            </span>
          ) : (
            <span className="truncate">{plural(papers, { one: "read", other: "all read" })}</span>
          )}
        </span>
        <FoldChevron open={open} className="-ml-1" />
      </button>
      <Unfold open={open}>
        <div className="flex flex-col pb-1">
          {readFrom.map((r) => {
            const paper = paperById(library, aliases, r.paperId)
            const row = "flex h-7 w-full items-center gap-2.5 rounded-md pr-2.5 pl-[38px] text-left text-detail"
            const inner = (
              <>
                <span className="min-w-0 flex-1 truncate text-foreground">{paper?.title ?? r.paperId}</span>
                <span className="shrink-0">{depthOf(r)}</span>
              </>
            )
            const hover = { onPointerEnter: () => mark([paper?.id ?? r.paperId]), onPointerLeave: () => mark(null) }
            // A paper in the Library opens there; one only cited has nowhere to go
            return paper ? (
              <button key={r.paperId} type="button" onClick={() => navigate(`/library/${paper.id}`)} className={`${row} outline-none hover:bg-muted focus-key:bg-muted`} {...hover}>
                {inner}
              </button>
            ) : (
              <div key={r.paperId} className={row} {...hover}>
                {inner}
              </div>
            )
          })}
        </div>
      </Unfold>
    </div>
  )
}
