import { useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useDocsStore } from "@/features/docs/store"
import { undoResult, useResultsStore, type AgentResult } from "../../results"

// Under an answer, one muted row per thing the reply changed outside the chat, with Undo and View: the
// same row Knowledge uses for a line changed from a chat. Several papers from one reply are one row,
// as are several notes or edits on one doc, so a long hand-off stays a few lines.
interface Row {
  key: string
  text: string
  results: AgentResult[]
  view?: () => void
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

function useRows(results: AgentResult[]): Row[] {
  const navigate = useNavigate()
  const openDoc = (path: string) => {
    const file = Object.values(useDocsStore.getState().files).find((f) => f.path === path)
    return file ? () => navigate(`/docs/${file.id}`) : undefined
  }
  const rows: Row[] = []
  const papers = results.filter((r) => r.kind === "paper")
  if (papers.length === 1) rows.push({ key: "papers", text: `Added ${papers[0].label} to your Library`, results: papers, view: () => navigate(`/library/${papers[0].path}`) })
  else if (papers.length > 1) rows.push({ key: "papers", text: `Added ${papers.length} papers to your Library`, results: papers, view: () => navigate("/library") })
  for (const kind of ["note", "file"] as const) {
    const byPath = new Map<string, AgentResult[]>()
    for (const r of results) if (r.kind === kind) byPath.set(r.path, [...(byPath.get(r.path) ?? []), r])
    for (const [path, list] of byPath) {
      const name = list[0].label
      // A paper's note is the user's own text, named by its paper and opened on the paper's page
      const notePaper = kind === "file" ? /^\.owlit\/papers\/([^/]+)\/note\.md$/.exec(path)?.[1] : undefined
      if (notePaper) {
        rows.push({ key: `${kind}:${path}`, text: `Edited your note on ${name}`, results: list, view: () => navigate(`/library/${notePaper}`) })
        continue
      }
      const text = kind === "note" ? `${plural(list.length, "A note", "notes")} on ${name}` : `Edited ${name}`
      rows.push({ key: `${kind}:${path}`, text, results: list, view: openDoc(path) })
    }
  }
  return rows
}

// Takes the row's changes back, newest first, so each restore finds the file as the next one left it
async function undo(messageId: string, row: Row) {
  const done: string[] = []
  try {
    for (const r of [...row.results].reverse()) {
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

// Muted text buttons, 24px tall: Undo is the one way to take a hand-off back, so it should be easy to hit
const BUTTON = "inline-flex h-6 items-center rounded-md px-1.5 outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted"

export function ResultRows({ messageId }: { messageId: string }) {
  const results = useResultsStore((s) => s.byMessage[messageId])
  const rows = useRows(results ?? [])
  if (!rows.length) return null
  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row) => {
        const undone = row.results.every((r) => r.undone)
        return (
          <p key={row.key} className="flex items-center gap-1 text-[13px] text-muted-foreground">
            <span className={undone ? undefined : "text-foreground"}>{undone ? `Undone · ${row.text}` : row.text}</span>
            {!undone && (
              <>
                <span aria-hidden>·</span>
                <button type="button" onClick={() => void undo(messageId, row)} className={BUTTON}>
                  Undo
                </button>
              </>
            )}
            {!undone && row.view && (
              <>
                <span aria-hidden>·</span>
                <button type="button" onClick={row.view} className={BUTTON}>
                  View
                </button>
              </>
            )}
          </p>
        )
      })}
    </div>
  )
}
