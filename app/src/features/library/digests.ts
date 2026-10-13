import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { isTaskFinished, type Task } from "@owlit/protocol"
import { toast } from "sonner"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { rpc } from "@/lib/rpc"
import { useTasksStore } from "@/features/tasks/store"
import { useLibraryStore } from "./store"
import type { Paper } from "./types"

// Where a paper's digest stands for the user, on the ladder of states (DESIGN.md, rule 3): being written,
// new since they last looked, or stopped. And who is told when one is done: only someone waiting for it,
// that is who saw it being written on the paper's page or asked for it from the paper's menu. A digest
// written in the background (every paper, or opening one while reading its PDF) only leaves its mark.

interface DigestMarks {
  // When each paper's digest was last on screen
  seen: Record<string, number>
  // When the user asked for each paper's digest from its menu: a paper never opened can still want one
  asked: Record<string, number>
  markSeen: (id: string) => void
  markAsked: (id: string) => void
}

export const useDigestMarks = create<DigestMarks>()(
  persist(
    (set) => ({
      seen: {},
      asked: {},
      markSeen: (id) => set((s) => ({ seen: { ...s.seen, [id]: Date.now() } })),
      markAsked: (id) => set((s) => ({ asked: { ...s.asked, [id]: Date.now() } })),
    }),
    { name: "owlit-digests", partialize: (s) => ({ seen: s.seen, asked: s.asked }) },
  ),
)

const digestTasks = (byId: Record<string, Task>, id: string) => Object.values(byId).filter((t) => t.kind === "paper.digest" && t.subject === id)

// The digest's last run broke and nothing has taken it up again. Known for this session only: core keeps
// a few finished tasks, and a digest that failed long ago is better asked for again from the menu.
function digestFailed(byId: Record<string, Task>, id: string) {
  const tasks = digestTasks(byId, id)
  if (tasks.some((t) => !isTaskFinished(t))) return false
  const last = tasks.sort((a, b) => b.createdAt - a.createdAt)[0]
  return last?.state === "failed"
}

// A digest Owlit wrote after the user last opened the paper (or asked for it) and that they haven't seen.
// One on a paper they never opened or asked about was written in the background and is not news.
export function isNewDigest(paper: Paper, marks: Pick<DigestMarks, "seen" | "asked">) {
  if (!paper.hasDigest || !paper.digestAt) return false
  if (!paper.lastOpenedAt && !marks.asked[paper.id]) return false
  return paper.digestAt > Math.max(marks.seen[paper.id] ?? 0, paper.lastOpenedAt ?? 0)
}

// The mark a paper's row and page show for its digest: writing while it is under way, stopped, or new.
// Under way is a run at work, or one opened or asked for that waits on its own first steps (the paper's
// figures); a background one only once at work, so a library-wide batch doesn't breathe on every row.
export type DigestState = "writing" | "failed" | "new" | null

export function useDigestState(paper: Paper): DigestState {
  const failed = useTasksStore((s) => digestFailed(s.byId, paper.id))
  const writing = useTasksStore((s) => digestTasks(s.byId, paper.id).some((t) => t.state === "running" || (!isTaskFinished(t) && t.priority !== "background")))
  const fresh = useDigestMarks((s) => isNewDigest(paper, s))
  return failed ? "failed" : writing ? "writing" : fresh ? "new" : null
}

// Whether a paper has a digest new since the user looked, by id (Home's rows, which hold no paper)
export function useNewDigest(paperId: string | undefined) {
  const paper = useLibraryStore((s) => (paperId ? s.papers[paperId] : undefined))
  return useDigestMarks((s) => !!paper && isNewDigest(paper, s))
}

export function useDigestFailed(paperId: string) {
  return useTasksStore((s) => digestFailed(s.byId, paperId))
}

// Asks for the digest again (Retry), and waits for it
export function retryDigest(paper: Paper) {
  waitForDigest(paper.id)
  return rpc.library.requestDigest({ id: paper.id, rewrite: !!paper.hasDigest })
}

// ---- Telling the one waiting ----

// Papers whose digest someone is waiting for, and since when; kept for this session
const waiting = new Map<string, number>()
// The paper whose digest is on screen now
let onScreen: string | null = null

export function waitForDigest(id: string) {
  if (!waiting.has(id)) waiting.set(id, Date.now())
}

// The digest view says it is showing; returns the call that says it no longer is
export function showingDigest(id: string) {
  onScreen = id
  return () => {
    if (onScreen === id) onScreen = null
  }
}

// How long a run that ended without a digest (a paper with no text to read) is given before the wait is
// dropped: core says a paper changed a moment after its task ends
const SETTLE_MS = 15_000

// Watches the waited-for digests from the shell. Done or stopped, the user hears it where they are: on the
// paper's page nothing is said (its switch carries the mark); elsewhere in owlit a toast that opens the
// digest; with owlit behind other windows a system notification too, as a chat waiting on them does.
export function useDigestNotices() {
  const navigate = useNavigate()
  useEffect(() => {
    const onPaperPage = (id: string) => document.hasFocus() && window.location.pathname === `/library/${id}`
    const notify = (title: string, paper: Paper, go: () => void) => {
      if (document.hasFocus() || typeof Notification === "undefined") return
      const notification = new Notification(title, { body: paper.title })
      notification.onclick = () => {
        window.focus()
        go()
      }
    }
    const check = () => {
      const papers = useLibraryStore.getState().papers
      const tasks = useTasksStore.getState().byId
      for (const [id, since] of waiting) {
        const paper = papers[id]
        if (!paper) {
          waiting.delete(id)
          continue
        }
        const runs = digestTasks(tasks, id)
        if (paper.hasDigest && (paper.digestAt ?? 0) >= since) {
          waiting.delete(id)
          if (onPaperPage(id)) continue
          const open = () => navigate(`/library/${id}`)
          toast("Digest ready", { description: paper.title, action: { label: "Open", onClick: open }, duration: 10_000 })
          notify("Digest ready", paper, open)
          continue
        }
        if (runs.some((t) => !isTaskFinished(t))) continue
        const last = runs.filter((t) => (t.endedAt ?? 0) >= since).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
        if (!last) continue
        if (last.state === "failed") {
          waiting.delete(id)
          if (onScreen === id && document.hasFocus()) continue
          const retry = () => void retryDigest(paper).catch(() => toast.error("Couldn't ask for the digest again."))
          toast("Couldn't write the digest", { description: paper.title, action: { label: "Retry", onClick: retry }, duration: 10_000 })
          notify("Couldn't write the digest", paper, () => navigate(`/library/${id}`))
        } else if (last.state === "cancelled" || Date.now() - (last.endedAt ?? 0) > SETTLE_MS) {
          waiting.delete(id)
        } else {
          setTimeout(check, SETTLE_MS)
        }
      }
    }
    const offPapers = useLibraryStore.subscribe((s, prev) => s.papers !== prev.papers && check())
    const offTasks = useTasksStore.subscribe((s, prev) => s.byId !== prev.byId && check())
    return () => {
      offPapers()
      offTasks()
    }
  }, [navigate])
}
