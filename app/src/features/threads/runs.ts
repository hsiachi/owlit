import { t } from "@lingui/core/macro"
import { threadOfSubject, THREAD_RUNS, isTaskFinished, type Thread, type ThreadRun, type ThreadSize, type Task } from "@owlit/protocol"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { tasksOfKind, useTasksStore } from "@/features/tasks/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { put } from "./store"

// Owlit's work on a thread in the background, read from the tasks core reports: what runs now, and
// a run that broke since, so the thread can say so where the user looks

export interface ThreadWork {
  running: (Task & { kind: ThreadRun })[]
  // The last run that failed, while nothing has run since
  broken?: Task & { kind: ThreadRun }
}

export function useThreadWork(id: string): ThreadWork {
  // Oldest first, so the run a line shows stays first while others start
  const tasks = useTasksStore(
    useShallow((s) =>
      THREAD_RUNS.flatMap((kind) => tasksOfKind(s.byId, kind))
        .filter((task) => threadOfSubject(task.subject) === id)
        .sort((a, b) => a.createdAt - b.createdAt),
    ),
  ) as (Task & { kind: ThreadRun })[]
  const running = tasks.filter((task) => !isTaskFinished(task))
  const last = [...tasks].sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))[0]
  return { running, ...(last?.state === "failed" && !running.length ? { broken: last } : {}) }
}

// What a run is doing, as a line on the page; a column's question names the column
export function runWords(task: Task & { kind: ThreadRun }, c: Thread | undefined): string {
  switch (task.kind) {
    case "threads.gather":
      return t`Gathering papers…`
    case "threads.more":
      return t`Finding more papers…`
    case "threads.fill": {
      const column = c?.columns.find((col) => col.id === task.subject.split(":")[1])
      const question = column?.question ?? ""
      return column?.kind === "grouping" ? t`Grouping the papers by “${question}”…` : t`Asking each paper “${question}”…`
    }
    case "threads.read":
      return t`Reading papers in full…`
  }
}

// What the browser preview says when asked for work only core does
export const desktopOnly = () => void toast(t`Owlit works on threads in the desktop app.`)

export async function gather(question: string, size: ThreadSize, project: string): Promise<Thread | undefined> {
  if (!isDesktop) {
    toast(t`Owlit gathers papers in the desktop app.`)
    return undefined
  }
  try {
    const { thread } = await rpc.threads.gather({ question, size, ...(project ? { project } : {}) })
    put(thread)
    return thread
  } catch (error) {
    toastError(error)
    return undefined
  }
}

// what: for more, what to look for this time
export async function startRun(id: string, run: "more" | "read", what?: string) {
  if (!isDesktop) return desktopOnly()
  await rpc.threads.run({ id, run, ...(what ? { what } : {}) }).catch(toastError)
}

// Group another way: a new grouping Owlit works out in the background; the thread with it
export async function groupAnotherWay(id: string, question: string): Promise<Thread | undefined> {
  if (!isDesktop) return void desktopOnly()
  try {
    const { thread } = await rpc.threads.group({ id, question })
    put(thread)
    return thread
  } catch (error) {
    toastError(error)
    return undefined
  }
}

export async function askEach(id: string, question: string) {
  if (!isDesktop) return desktopOnly()
  try {
    put((await rpc.threads.ask({ id, question })).thread)
  } catch (error) {
    toastError(error)
  }
}
