import { useState, type ComponentType } from "react"
import { toast } from "sonner"
import { BookOpenIcon, ChevronRightIcon, FileTextIcon, StickyNoteIcon } from "lucide-react"
import { useOpenFromChat } from "@/features/agent/hooks"
import { useDocsStore } from "@/features/docs/store"
import { useKnowledgeRows } from "@/features/knowledge/components/ChatUpdates"
import type { ChatMessage } from "../../types"
import { undoResult, useResultsStore, type AgentResult } from "../../results"
import { diffCounts } from "./step-results"

// Under an answer, one card listing what the reply changed outside the chat: docs edited, papers added,
// notes left, Knowledge updated. A row opens what it names; Undo shows on hover, since it's rarely wanted
// and a column of Undo buttons reads as a form to fill in. Several notes or edits on one doc are one
// row, so a long hand-off stays a few lines; past FOLD_AFTER rows the rest wait behind "Show N more".
export interface ResultRow {
  key: string
  icon: ComponentType<{ className?: string }>
  name: string
  // At the right: "+31 −1" for an edit, "Added" for a paper, "3 notes"
  detail?: React.ReactNode
  undone: boolean
  view?: () => void
  undo?: () => Promise<void> | void
  // For the summary line: what kind of change, and how many lines an edit added and removed
  kind: "doc" | "paper" | "note" | "knowledge"
  lines?: { added: number; removed: number }
}

const FOLD_AFTER = 3

// Lines added and removed in a file by the reply's own edits, read from their diffs
function linesIn(parts: ChatMessage["parts"], path: string) {
  let added = 0
  let removed = 0
  let any = false
  for (const p of parts) {
    if (p.type !== "tool_call" || p.status !== "completed" || !p.diff) continue
    const at = p.diff.path
    if (at !== path && !at.endsWith(`/${path}`)) continue
    const c = diffCounts(p.diff.oldText ?? "", p.diff.newText)
    added += c.added
    removed += c.removed
    any = true
  }
  return any ? { added, removed } : undefined
}

// "+31 −1": new lines in Owlit's suggestion colour, as the doc marks its edits; removals muted, never red
export function LineCounts({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="tabular-nums">
      {added > 0 && <span className="text-suggestion">+{added}</span>}
      {added > 0 && removed > 0 && " "}
      {removed > 0 && <span>−{removed}</span>}
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
  const openDoc = (path: string) => {
    const file = Object.values(useDocsStore.getState().files).find((f) => f.path === path)
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
        rows.push({ key: `note:${path}`, kind: "note", icon: StickyNoteIcon, name, detail: list.length === 1 ? "1 note" : `${list.length} notes`, ...of(list), view: openDoc(path) })
        continue
      }
      const lines = linesIn(message.parts, path)
      // A paper's note is the user's own text, named by its paper and opened on the paper's page
      const notePaper = /^\.owlit\/papers\/([^/]+)\/note\.md$/.exec(path)?.[1]
      rows.push({
        key: `file:${path}`,
        kind: "doc",
        icon: notePaper ? BookOpenIcon : FileTextIcon,
        name: notePaper ? `Your note on ${name}` : name,
        detail: lines ? <LineCounts {...lines} /> : undefined,
        lines,
        ...of(list),
        view: notePaper ? () => navigate(`/library/${notePaper}`) : openDoc(path),
      })
    }
  }
  // Edits to the user's own docs first: they matter most and must not fold away behind papers
  for (const r of results.filter((r) => r.kind === "paper")) {
    rows.push({ key: `paper:${r.versionId}`, kind: "paper", icon: BookOpenIcon, name: r.label, detail: "Added", ...of([r]), view: () => navigate(`/library/${r.path}`) })
  }
  return rows
}

const count = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

// "Edited 2 docs and added 3 papers"
function summary(rows: ResultRow[]) {
  const n = (kind: ResultRow["kind"]) => rows.filter((r) => r.kind === kind).length
  const said = [
    n("doc") && `edited ${count(n("doc"), "a doc", "docs")}`,
    n("paper") && `added ${count(n("paper"), "a paper", "papers")}`,
    n("note") && `left notes on ${count(n("note"), "a doc", "docs")}`,
    n("knowledge") && `updated ${count(n("knowledge"), "a topic", "topics")}`,
  ].filter(Boolean) as string[]
  const text = said.length > 1 ? `${said.slice(0, -1).join(", ")} and ${said.at(-1)}` : said[0]
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Muted text button inside a row, 24px tall so Undo is easy to hit
const BUTTON = "inline-flex h-6 items-center rounded-md px-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted"
const SHOW_ON_HOVER = "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"

function Row({ row, className }: { row: ResultRow; className?: string }) {
  const Icon = row.icon
  const live = !row.undone
  return (
    <div className={`group/row relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm ${row.view && live ? "hover:bg-muted" : ""} ${className ?? ""}`}>
      {/* The whole row opens what it names; Undo sits above that click */}
      {row.view && live && <button type="button" onClick={row.view} aria-label={`Open ${row.name}`} className="absolute inset-0 rounded-md outline-none focus-key:bg-muted" />}
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className={`min-w-0 truncate ${live ? "text-foreground" : "text-muted-foreground line-through"}`}>{row.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        {live && row.undo && (
          <button type="button" onClick={() => void row.undo!()} className={`relative ${BUTTON} ${SHOW_ON_HOVER}`}>
            Undo
          </button>
        )}
        {live ? row.detail : "Undone"}
        <ChevronRightIcon className={`size-3.5 ${row.view && live ? "opacity-60" : "invisible"}`} />
      </span>
    </div>
  )
}

export function ResultCard({ message }: { message: ChatMessage }) {
  const rows = [...useResultRows(message), ...useKnowledgeRows(message.parts)]
  const [all, setAll] = useState(false)
  if (!rows.length) return null
  const live = rows.filter((r) => !r.undone && r.undo)
  const total = rows.reduce((t, r) => (r.lines && !r.undone ? { added: t.added + r.lines.added, removed: t.removed + r.lines.removed } : t), { added: 0, removed: 0 })
  const folded = !all && rows.length > FOLD_AFTER + 1 ? rows.length - FOLD_AFTER : 0
  return (
    <div className="flex flex-col rounded-lg border p-1">
      {/* One change says itself; several get a line saying what happened, with Undo for all of them */}
      {rows.length > 1 && (
        <div className="group/row flex h-9 items-center gap-2.5 px-2.5 text-sm">
          <span className="min-w-0 truncate text-foreground">{summary(rows)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {live.length > 1 && (
              <button type="button" onClick={() => void Promise.all(live.map((r) => r.undo!()))} className={`${BUTTON} ${SHOW_ON_HOVER}`}>
                Undo all
              </button>
            )}
            {(total.added > 0 || total.removed > 0) && <LineCounts {...total} />}
            <ChevronRightIcon className="invisible size-3.5" />
          </span>
        </div>
      )}
      {rows.slice(0, folded ? FOLD_AFTER : undefined).map((row) => (
        <Row key={row.key} row={row} />
      ))}
      {folded > 0 && (
        <button type="button" onClick={() => setAll(true)} className="flex h-9 items-center rounded-md pr-2.5 pl-[38px] text-left text-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted">
          Show {folded} more
        </button>
      )}
    </div>
  )
}
