import { useEffect, useState } from "react"
import { create } from "zustand"
import { editStats, type EditStats } from "@owlit/protocol"
import { toast } from "sonner"
import { ArrowUpRightIcon, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { KIND_ICON } from "@/lib/kinds"
import { useOpenFromChat } from "@/features/agent/hooks"
import { fileAt } from "@/features/docs/store"
import { useKnowledgeRows } from "@/features/knowledge/components/ChatUpdates"
import type { ChatMessage } from "../../types"
import { undoResult, useResultsStore, type AgentResult } from "../../results"
import { isDesktop, rpc } from "@/lib/rpc"
import { capital, joinAnd } from "@/lib/words"

// Under an answer, one card listing what the reply changed outside the chat: docs edited, papers added,
// notes left, Knowledge updated. A row goes to what it names, in the main view rather than opening
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
  // For the summary line: what kind of change, and how much an edit changed
  kind: "doc" | "paper" | "note" | "knowledge"
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

// "+31 −1": new words in Owlit's suggestion colour, as the doc marks its edits; removals muted, never red.
// A doc mostly replaced says "Rewritten" instead of two large numbers. Lines say their unit.
export function EditCounts({ stats }: { stats: EditStats }) {
  if (stats.rewritten) return <span>Rewritten</span>
  const { added, removed } = stats
  return (
    <span className="tabular-nums" title={`${stats.unit === "words" ? "Words" : "Lines"} added and removed`}>
      {added > 0 && <span className="text-suggestion">+{added.toLocaleString()}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span>−{removed.toLocaleString()}</span>}
      {stats.unit === "lines" && (added > 0 || removed > 0) && ` ${added + removed === 1 ? "line" : "lines"}`}
    </span>
  )
}

// Takes a row's changes back, newest first, so each restore finds the file as the next one left it
async function undoResults(messageId: string, results: AgentResult[]) {
  const done: string[] = []
  try {
    for (const r of [...results].reverse()) {
      if (r.undone) continue
      await undoResult(r.versionId)
      done.push(r.versionId)
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  } finally {
    if (done.length) useResultsStore.getState().markUndone(messageId, done)
  }
}

function useResultRows(message: ChatMessage): ResultRow[] {
  const navigate = useOpenFromChat()
  const results = useResultsStore((s) => s.byMessage[message.id]) ?? []
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
  const of = (list: AgentResult[]) => ({ undone: list.every((r) => r.undone), undo: () => undoResults(message.id, list) })
  for (const kind of ["file", "note"] as const) {
    const byPath = new Map<string, AgentResult[]>()
    for (const r of results) if (r.kind === kind) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r])
    for (const [path, list] of byPath) {
      const name = list[0].label
      if (kind === "note") {
        rows.push({ key: `note:${path}`, kind: "note", icon: KIND_ICON.note, name, detail: list.length === 1 ? "1 note" : `${list.length} notes`, ...of(list), view: openDoc(path) })
        continue
      }
      const span = spans.find((s) => s.path === path)
      const edit = span ? (stats[span.key] ?? undefined) : statsFromParts(message.parts, path)
      // A paper's note is the user's own text, named by its paper and opened on the paper's page
      const notePaper = /^\.owlit\/papers\/([^/]+)\/note\.md$/.exec(path)?.[1]
      rows.push({
        key: `file:${path}`,
        kind: "doc",
        icon: notePaper ? KIND_ICON.paper : KIND_ICON.doc,
        name: notePaper ? `Your note on ${name}` : name,
        detail: edit ? <EditCounts stats={edit} /> : undefined,
        stats: edit,
        markdown: /\.(md|markdown)$/i.test(path),
        ...of(list),
        view: notePaper ? () => navigate(`/library/${notePaper}`) : openDoc(path),
      })
    }
  }
  // Edits to the user's own docs first: they matter most and must not fold away behind papers
  for (const r of results.filter((r) => r.kind === "paper")) {
    // A paper the agent took back has nothing to open; Undo puts it back
    const view = r.removed ? undefined : () => navigate(`/library/${r.path}`)
    rows.push({ key: `paper:${r.versionId}`, kind: "paper", icon: KIND_ICON.paper, name: r.label, detail: r.removed ? "Removed" : "Added", ...of([r]), view, removed: r.removed })
  }
  return rows
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)
const added = (rows: ResultRow[]) => rows.filter((r) => r.kind === "paper" && !r.removed).length
const removed = (rows: ResultRow[]) => rows.filter((r) => r.kind === "paper" && r.removed).length

// "Edited 2 docs and added 3 papers"
function summary(rows: ResultRow[]) {
  const n = (kind: ResultRow["kind"]) => rows.filter((r) => r.kind === kind).length
  const said = [
    // A doc is a Markdown file of the user's; a script or a paper's .tex is a file
    n("doc") && `edited ${rows.filter((r) => r.kind === "doc").every((r) => r.markdown) ? count(n("doc"), "a doc", "docs") : count(n("doc"), "a file", "files")}`,
    added(rows) && `added ${count(added(rows), "a paper", "papers")}`,
    removed(rows) && `removed ${count(removed(rows), "a paper", "papers")}`,
    n("note") && `left notes on ${count(n("note"), "a doc", "docs")}`,
    n("knowledge") && `updated ${count(n("knowledge"), "a topic", "topics")}`,
  ].filter(Boolean) as string[]
  return capital(joinAnd(said))
}

const SHOW_ON_HOVER = "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"

function Row({ row, className }: { row: ResultRow; className?: string }) {
  const Icon = row.icon
  const live = !row.undone
  return (
    <div className={`group/row relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm ${row.view && live ? "hover:bg-muted" : ""} ${className ?? ""}`}>
      {/* The whole row opens what it names; Undo sits above that click */}
      {row.view && live && <button type="button" onClick={row.view} aria-label={`Open ${row.name}`} className="absolute inset-0 rounded-md outline-none focus-key:bg-muted" />}
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className={`min-w-0 truncate ${live ? "text-foreground" : "text-muted-foreground line-through"}`}>{row.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-detail text-muted-foreground">
        {live && row.undo && (
          <Button variant="text" size="inline" onClick={() => void row.undo!()} className={`relative ${SHOW_ON_HOVER}`}>
            Undo
          </Button>
        )}
        {live ? row.detail : "Undone"}
        <ArrowUpRightIcon className={`size-3.5 ${row.view && live ? SHOW_ON_HOVER : "invisible"}`} />
      </span>
    </div>
  )
}

export function ResultCard({ message }: { message: ChatMessage }) {
  const rows = [...useResultRows(message), ...useKnowledgeRows(message.parts)]
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const live = rows.filter((r) => !r.undone && r.undo)
  // The total counts in one unit only: words when every edit was to prose
  const edits = rows.flatMap((r) => (r.stats && !r.undone ? [r.stats] : []))
  const total: EditStats | undefined =
    edits.length > 1 && edits.every((e) => e.unit === edits[0].unit)
      ? { unit: edits[0].unit, added: edits.reduce((t, e) => t + e.added, 0), removed: edits.reduce((t, e) => t + e.removed, 0), rewritten: false }
      : undefined
  const folded = !all && rows.length > FOLD_AFTER + 1 ? rows.length - FOLD_AFTER : 0
  return (
    <div className="flex flex-col rounded-lg border p-1">
      {/* One change says itself; several get a line saying what happened, with Undo for all of them */}
      {rows.length > 1 && (
        <div className="group/row flex h-8 items-center gap-2.5 px-2.5 text-sm">
          <span className="min-w-0 truncate text-foreground">{summary(rows)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-detail text-muted-foreground">
            {live.length > 1 && (
              <Button variant="text" size="inline" onClick={() => void Promise.all(live.map((r) => r.undo!()))} className={SHOW_ON_HOVER}>
                Undo all
              </Button>
            )}
            {total && (total.added > 0 || total.removed > 0) && <EditCounts stats={total} />}
            <ArrowUpRightIcon className="invisible size-3.5" />
          </span>
        </div>
      )}
      {rows.slice(0, folded ? FOLD_AFTER : undefined).map((row) => (
        <Row key={row.key} row={row} />
      ))}
      {folded > 0 && (
        <button type="button" onClick={() => setAll(true)} className="flex h-8 items-center rounded-md pr-2.5 pl-[38px] text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted">
          Show {folded} more
        </button>
      )}
    </div>
  )
}
