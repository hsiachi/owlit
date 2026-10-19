import { t } from "@lingui/core/macro"
import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { isTaskFinished, type Paper, type Task } from "@owlit/protocol"
import { toast } from "sonner"
import { notifyWhenAway } from "@/lib/notify"
import { rpc } from "@/lib/rpc"
import { routeSubject } from "@/app/route-subject"
import { useDigestUnseen } from "@/app/seen"
import { toastError } from "@/lib/toast"
import { cancelTask, tasksFor, useTasksStore } from "@/features/tasks/store"
import { useLibraryStore } from "./store"

// Where a paper's digest stands for the user, on the ladder of states (DESIGN.md, rule 3): being written,
// new since they last looked, or stopped. And who is told when one is done: only someone waiting for it,
// that is who saw it being written on the paper's page or asked for it from the paper's menu. One asked
// for in a chat or by an agent only leaves its mark.

// A paper's digest runs, finished ones too; a fresh array, free to sort
const digestTasks = (byId: Record<string, Task>, id: string) => tasksFor(byId, id).filter((task) => task.kind === "paper.digest")

// A run for the paper's digest is under way or waiting its turn
export const digestUnderWay = (byId: Record<string, Task>, id: string) => tasksFor(byId, id).some((task) => task.kind === "paper.digest" && !isTaskFinished(task))

// The digest's last run broke and nothing has taken it up again. Known for this session only: core keeps
// a few finished tasks, and a digest that failed long ago is better asked for again from the menu.
export function digestFailed(byId: Record<string, Task>, id: string) {
  const tasks = digestTasks(byId, id)
  if (tasks.some((task) => !isTaskFinished(task))) return false
  const last = tasks.sort((a, b) => b.createdAt - a.createdAt)[0]
  return last?.state === "failed"
}

// The mark a paper's row and page show for its digest: writing while it is under way (at work, or waiting
// on its first steps, the paper's figures), stopped, or new.
export type DigestState = "writing" | "failed" | "new" | null

export function useDigestState(paper: Paper): DigestState {
  const failed = useTasksStore((s) => digestFailed(s.byId, paper.id))
  const writing = useTasksStore((s) => digestUnderWay(s.byId, paper.id))
  // New since the user last looked (protocol's digestUnseen, which core answers)
  const fresh = useDigestUnseen(paper.id)
  return failed ? "failed" : writing ? "writing" : fresh ? "new" : null
}

// Whether a paper has a digest new since the user looked, by id (Home's rows, which hold no paper)
export const useNewDigest = useDigestUnseen

// Any run for the digest, background ones too: the paper's page says it is being written
export function useWritingDigest(paperId: string) {
  return useTasksStore((s) => digestUnderWay(s.byId, paperId))
}

// Stops the paper's digest: every run for it still under way or waiting its turn
export function stopDigest(paperId: string) {
  for (const task of digestTasks(useTasksStore.getState().byId, paperId)) if (!isTaskFinished(task)) void cancelTask(task.id).catch(toastError)
}

export function useDigestFailed(paperId: string) {
  return useTasksStore((s) => digestFailed(s.byId, paperId))
}

// Asks for the paper's digest again, saying so when the asking itself failed; resolves to whether it was asked
export function askDigestAgain(paper: Paper, rewrite: boolean) {
  return rpc.library.requestDigest({ id: paper.id, rewrite }).then(
    () => true,
    () => {
      toast.error(t`Couldn't ask for the digest again.`)
      return false
    },
  )
}

// Asks for the digest again (Retry), and waits for it
export function retryDigest(paper: Paper) {
  waitForDigest(paper.id)
  return askDigestAgain(paper, !!paper.hasDigest)
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
    const onPaperPage = (id: string) => {
      const subject = routeSubject(window.location.pathname)
      return document.hasFocus() && subject?.kind === "paper" && subject.id === id
    }
    // One wait for runs that ended without a digest yet, however many changes come in meantime
    let settle: ReturnType<typeof setTimeout> | undefined
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
          toast(t`Digest ready`, { description: paper.title, action: { label: t({ message: "Open", comment: "toast button: open the paper's digest" }), onClick: open }, duration: 10_000 })
          notifyWhenAway({ title: t`Digest ready`, body: paper.title, onClick: open })
          continue
        }
        if (runs.some((task) => !isTaskFinished(task))) continue
        const last = runs.filter((task) => (task.endedAt ?? 0) >= since).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0]
        if (!last) continue
        if (last.state === "failed") {
          waiting.delete(id)
          if (onScreen === id && document.hasFocus()) continue
          const retry = () => void retryDigest(paper)
          toast(t`Couldn't write the digest`, { description: paper.title, action: { label: t`Retry`, onClick: retry }, duration: 10_000 })
          notifyWhenAway({ title: t`Couldn't write the digest`, body: paper.title, onClick: () => navigate(`/library/${id}`) })
        } else if (last.state === "cancelled" || Date.now() - (last.endedAt ?? 0) > SETTLE_MS) {
          waiting.delete(id)
        } else {
          settle ??= setTimeout(() => {
            settle = undefined
            check()
          }, SETTLE_MS)
        }
      }
    }
    const offPapers = useLibraryStore.subscribe((s, prev) => s.papers !== prev.papers && check())
    const offTasks = useTasksStore.subscribe((s, prev) => s.byId !== prev.byId && check())
    return () => {
      offPapers()
      offTasks()
      clearTimeout(settle)
    }
  }, [navigate])
}
