import { plural, t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { editStats, type EditStats } from "@owlit/protocol"
import { ArrowUpRightIcon, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Unfold } from "@/components/unfold"
import { KIND_ICON } from "@/lib/kinds"
import { useOpenFromChat } from "@/features/agent/hooks"
import { openEditor } from "@/features/docs/editors"
import { fileAt, filesByPath, useDocsStore } from "@/features/docs/store"
import { useDigestRows } from "@/features/library/digest-rows"
import { paperOfNotePath } from "@/features/library/notes/note-actions"
import type { ChatMessage } from "../../types"
import { redoResult, undoResult, useResultsStore, type AgentResult } from "../../results"
import { countParts } from "../../lib/edit-counts"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { capital, joinActions } from "@/lib/words"

// Under an answer, one card listing what the reply changed outside the chat: docs edited, papers added,
// notes left, papers gathered into a thread, digests asked for (followed until written). A row goes to what it names, in the main view rather than opening
// anything in place, so its mark is a go-to arrow, and only on hover: at rest every row looks the same,
// whether or not it has somewhere to go. Undo shows on hover too, since it's rarely wanted and a column
// of Undo buttons reads as a form to fill in. Rows sit tight: nothing in the card stays selected. Several notes or edits on one doc are one
// row, so a long hand-off stays a few lines; past FOLD_AFTER rows the rest wait behind "Show N more".
export interface ResultRow {
  key: string
  icon: LucideIcon
  name: string
  // At the right: "+31 −1" for an edit, "Added" for a paper, "3 notes"
  detail?: React.ReactNode
  undone: boolean
  view?: () => void
  undo?: () => Promise<void> | void
  // On an undone row, when the change can be put back
  redo?: () => Promise<void> | void
  // One more thing the row offers on hover, before Undo ("Keep it separate")
  extra?: { label: string; run: () => Promise<void> | void }
  // For the summary line: what kind of change, and how much an edit changed
  kind: "doc" | "paper" | "note" | "digest" | "thread"
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

// What the reply's edits to a file amounted to. Core reads it from the versions it kept, which is the whole
// change whatever the agent reported; without core (the browser preview) the reply's own diffs are summed.
const statsCache = create<{ byKey: Record<string, EditStats | null>; load: (from: string, to: string) => void }>()((set, get) => ({
  byKey: {},
  load: (from, to) => {
    const key = `${from}|${to}`
    if (key in get().byKey) return
    set((s) => ({ byKey: { ...s.byKey, [key]: null } }))
    void rpc.versions
      .stats({ from, to })
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

// A doc's text as the reply left it, kept when the card undoes the reply's edits there (by message and
// path). The row follows the doc: once it reads that way again, by Redo or by ⌘Z in the doc, the edit is
// live again, whichever brought it back. `left` waits for the doc to move off that text first, since the
// undo reaches the doc after its row is marked. Kept for this launch only; Redo itself doesn't need it.
const appliedText = new Map<string, { text: string; left: boolean }>()
const appliedKey = (messageId: string, path: string) => `${messageId}|${path}`

function rememberApplied(messageId: string, path: string) {
  const file = fileAt(path)
  const text = file ? (openEditor(file.id)?.state.doc.toString() ?? file.content) : undefined
  if (text !== undefined) appliedText.set(appliedKey(messageId, path), { text, left: false })
}

// Takes a row's changes back, newest first, so each restore finds the file as the next one left it
async function undoResults(messageId: string, results: AgentResult[]) {
  const done: Record<string, string | undefined> = {}
  if (results[0]?.kind === "file") rememberApplied(messageId, results[0].path)
  try {
    for (const r of [...results].reverse()) {
      if (r.undone) continue
      done[r.versionId] = await undoResult(r.versionId)
    }
  } catch (error) {
    toastError(error)
  } finally {
    if (Object.keys(done).length) useResultsStore.getState().markUndone(messageId, done)
  }
}

// Puts a row's changes back, oldest first: the reverse of the undo, so each finds the file as it left it
async function redoResults(messageId: string, results: AgentResult[]) {
  const done: string[] = []
  try {
    for (const r of results) {
      if (!r.undone || !r.redoId) continue
      await redoResult(r.redoId)
      done.push(r.versionId)
    }
  } catch (error) {
    toastError(error)
  } finally {
    if (done.length) {
      appliedText.delete(appliedKey(messageId, results[0].path))
      useResultsStore.getState().markRedone(messageId, done)
    }
  }
}

// Undone doc edits whose doc reads as the reply left it again come back as live rows
function useFollowDocs(messageId: string, results: AgentResult[]) {
  const paths = [...new Set(results.filter((r) => r.kind === "file" && r.undone && appliedText.has(appliedKey(messageId, r.path))).map((r) => r.path))]
  const texts = useDocsStore(useShallow((s) => paths.map((p) => filesByPath(s.files).get(p)?.content)))
  useEffect(() => {
    paths.forEach((path, i) => {
      const kept = appliedText.get(appliedKey(messageId, path))
      if (!kept) return
      if (texts[i] !== kept.text) {
        kept.left = true
        return
      }
      if (!kept.left) return
      appliedText.delete(appliedKey(messageId, path))
      useResultsStore.getState().markRedone(
        messageId,
        results.filter((r) => r.kind === "file" && r.path === path).map((r) => r.versionId),
      )
    })
  })
}

function useResultRows(message: ChatMessage): ResultRow[] {
  const navigate = useOpenFromChat()
  const results = useResultsStore((s) => s.byMessage[message.id]) ?? []
  useFollowDocs(message.id, results)
  const stats = statsCache((s) => s.byKey)
  // Each file's first and last version from this reply, whose stats core is asked for once
  const spans = isDesktop
    ? [...new Map(results.filter((r) => r.kind === "file").map((r) => [r.path, r])).keys()].map((path) => {
        const list = results.filter((r) => r.kind === "file" && r.path === path).sort((a, b) => a.at - b.at)
        return { path, key: `${list[0].versionId}|${list.at(-1)!.versionId}`, from: list[0].versionId, to: list.at(-1)!.versionId }
      })
    : []
  const wanted = spans.map((s) => s.key).join(",")
  useEffect(() => {
    for (const s of spans) statsCache.getState().load(s.from, s.to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])
  const openDoc = (path: string) => {
    const file = fileAt(path)
    return file ? () => navigate(`/docs/${file.id}`) : undefined
  }
  const rows: ResultRow[] = []
  const of = (list: AgentResult[]) => {
    const undone = list.every((r) => r.undone)
    return {
      undone,
      undo: () => undoResults(message.id, list),
      ...(undone && list.every((r) => r.redoId) ? { redo: () => redoResults(message.id, list) } : {}),
    }
  }
  for (const kind of ["file", "note"] as const) {
    const byPath = new Map<string, AgentResult[]>()
    for (const r of results) if (r.kind === kind) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r])
    for (const [path, list] of byPath) {
      const name = list[0].label
      if (kind === "note") {
        rows.push({ key: `note:${path}`, kind: "note", icon: KIND_ICON.note, name, detail: plural(list.length, { one: "# note", other: "# notes" }), ...of(list), view: openDoc(path) })
        continue
      }
      const span = spans.find((s) => s.path === path)
      const edit = span ? (stats[span.key] ?? undefined) : statsFromParts(message.parts, path)
      // A paper's note is the user's own text, named by its paper and opened on the paper's page
      const notePaper = paperOfNotePath(path)
      rows.push({
        key: `file:${path}`,
        kind: "doc",
        icon: notePaper ? KIND_ICON.paper : KIND_ICON.doc,
        name: notePaper ? t`Your note on ${name}` : name,
        detail: edit ? <EditCounts stats={edit} /> : undefined,
        stats: edit,
        markdown: /\.(md|markdown)$/i.test(path),
        ...of(list),
        view: notePaper ? () => navigate(`/library/${notePaper}`) : openDoc(path),
      })
    }
  }
  // Threads the reply gathered papers into, one row each however many writes it took
  const byThread = new Map<string, AgentResult[]>()
  for (const r of results) if (r.kind === "thread") byThread.set(r.path, [...(byThread.get(r.path) ?? []), r])
  for (const [id, list] of byThread) {
    const last = list.at(-1)!
    const created = list.some((r) => r.created)
    const rowIds = [...new Set(list.flatMap((r) => r.rows ?? []))]
    const papers = rowIds.length
    const updated = list.reduce((n, r) => n + (r.updated ?? 0), 0)
    const answers = updated ? plural(updated, { one: "# answer updated", other: "# answers updated" }) : undefined
    const separate = last.separate
    const asked = list.find((r) => r.asked)?.asked
    rows.push({
      key: `thread:${id}`,
      kind: "thread",
      icon: KIND_ICON.thread,
      name: separate ? separate.title : last.label,
      created,
      papers,
      detail: separate ? (
        t({ message: "Kept separate", comment: "papers the agent added to a thread, moved by the user into a thread of their own" })
      ) : created ? (
        plural(papers, { one: "New thread · # paper", other: "New thread · # papers" })
      ) : papers ? (
        <span className="tabular-nums">
          <span className="text-owlit">+{papers}</span> {plural(papers, { one: "paper", other: "papers" })}
          {answers && ` · ${answers}`}
        </span>
      ) : (
        (answers ?? t({ message: "Updated", comment: "a thread the agent changed without adding papers" }))
      ),
      // Kept separate, Undo puts the papers back where the reply wrote them
      ...(separate
        ? {
            undone: false,
            undo: async () => {
              try {
                await rpc.threads.unsplit({ id: separate.id })
                useResultsStore.getState().markSeparate(message.id, list.map((r) => r.versionId), null)
              } catch (error) {
                toastError(error)
              }
            },
          }
        : of(list)),
      view: () => navigate(`/threads/${separate?.id ?? id}`),
      // Owlit added to a thread whose question was close; the user may want these papers on their own
      ...(!created && !separate && rowIds.length && isDesktop
        ? {
            extra: {
              label: t({ message: "Keep it separate", comment: "make the papers the agent just added into a thread of their own" }),
              run: async () => {
                try {
                  const c = await rpc.threads.split({ id, rows: rowIds, asked: asked ?? "" })
                  useResultsStore.getState().markSeparate(message.id, list.map((r) => r.versionId), { id: c.id, title: c.title })
                } catch (error) {
                  toastError(error)
                }
              },
            },
          }
        : {}),
    })
  }
  // Edits to the user's own docs first: they matter most and must not fold away behind papers
  for (const r of results.filter((r) => r.kind === "paper")) {
    // A paper the agent took back has nothing to open; Undo puts it back
    const view = r.removed ? undefined : () => navigate(`/library/${r.path}`)
    rows.push({ key: `paper:${r.versionId}`, kind: "paper", icon: KIND_ICON.paper, name: r.label, detail: r.removed ? t({ message: "Removed", comment: "a paper the agent took out of the library" }) : t({ message: "Added", comment: "a paper the agent added to the library" }), ...of([r]), view, removed: r.removed })
  }
  return rows
}

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
    n("note") && plural(n("note"), { one: "left notes on a doc", other: "left notes on # docs" }),
    started(rows) && plural(started(rows), { one: "started a thread", other: "started # threads" }),
    gathered(rows) && plural(gathered(rows), { one: "added a paper to a thread", other: "added # papers to threads" }),
    n("digest") && plural(n("digest"), { one: "asked for a digest", other: "asked for # digests" }),
  ].filter(Boolean) as string[]
  return capital(joinActions(said))
}

const SHOW_ON_HOVER = "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"

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
      <span
        data-struck={live ? undefined : ""}
        className={`strike min-w-0 truncate transition-colors duration-(--t-mark) ease-(--ease) ${live ? "text-foreground" : "text-muted-foreground"}`}
      >
        {row.name}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-detail text-muted-foreground">
        {live && row.extra && (
          <Button variant="text" size="inline" onClick={() => void row.extra!.run()} className={`relative ${SHOW_ON_HOVER}`}>
            {row.extra.label}
          </Button>
        )}
        {live && row.undo && (
          <Button variant="text" size="inline" onClick={() => void row.undo!()} className={`relative ${SHOW_ON_HOVER}`}>
            {t({ message: "Undo", comment: "verb: take back a change the agent made" })}
          </Button>
        )}
        {!live && row.redo && (
          <Button variant="text" size="inline" onClick={() => void row.redo!()} className={`relative ${SHOW_ON_HOVER}`}>
            {t({ message: "Redo", comment: "verb: put back a change that was undone" })}
          </Button>
        )}
        {live ? row.detail : t({ message: "Undone", comment: "a change that was taken back" })}
        <ArrowUpRightIcon className={`size-3.5 ${row.view && live ? SHOW_ON_HOVER : "invisible"}`} />
      </span>
    </div>
  )
}

export function ResultCard({ message }: { message: ChatMessage }) {
  const rows = [...useResultRows(message), ...useDigestRows(message.parts)]
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const live = rows.filter((r) => !r.undone && r.undo)
  // The total counts in one unit only: words when every edit was to prose
  const edits = rows.flatMap((r) => (r.stats && !r.undone ? [r.stats] : []))
  const total: EditStats | undefined =
    edits.length > 1 && edits.every((e) => e.unit === edits[0].unit)
      ? { unit: edits[0].unit, added: edits.reduce((t, e) => t + e.added, 0), removed: edits.reduce((t, e) => t + e.removed, 0), rewritten: false }
      : undefined
  // The rest unfold above the "Show N more" line, which stays as "Show less" to fold them back
  const rest = rows.length > FOLD_AFTER + 1 ? rows.slice(FOLD_AFTER) : []
  return (
    <div className="flex flex-col rounded-lg border p-1">
      {/* One change says itself; several get a line saying what happened, with Undo for all of them */}
      {rows.length > 1 && (
        <div className="group/row flex h-8 items-center gap-2.5 px-2.5 text-sm">
          <span className="min-w-0 truncate text-foreground">{summary(rows)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-detail text-muted-foreground">
            {live.length > 1 && (
              <Button variant="text" size="inline" onClick={() => void Promise.all(live.map((r) => r.undo!()))} className={SHOW_ON_HOVER}>
                {t({ message: "Undo all", comment: "verb: take back every change of the reply" })}
              </Button>
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
