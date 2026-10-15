import { t } from "@lingui/core/macro"
import { collectionOfSubject, COLLECTION_RUNS, isTaskFinished, type Collection, type CollectionRun, type CollectionSize, type Task } from "@owlit/protocol"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { tasksOfKind, useTasksStore } from "@/features/tasks/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { put } from "./store"

// Owlit's work on a collection in the background, read from the tasks core reports: what runs now, and
// a run that broke since, so the collection can say so where the user looks

export interface CollectionWork {
  running: (Task & { kind: CollectionRun })[]
  // The last run that failed, while nothing has run since
  broken?: Task & { kind: CollectionRun }
}

export function useCollectionWork(id: string): CollectionWork {
  // Oldest first, so the run a line shows stays first while others start
  const tasks = useTasksStore(
    useShallow((s) =>
      COLLECTION_RUNS.flatMap((kind) => tasksOfKind(s.byId, kind))
        .filter((task) => collectionOfSubject(task.subject) === id)
        .sort((a, b) => a.createdAt - b.createdAt),
    ),
  ) as (Task & { kind: CollectionRun })[]
  const running = tasks.filter((task) => !isTaskFinished(task))
  const last = [...tasks].sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))[0]
  return { running, ...(last?.state === "failed" && !running.length ? { broken: last } : {}) }
}

// What a run is doing, as a line on the page; a column's question names the column
export function runWords(task: Task & { kind: CollectionRun }, c: Collection | undefined): string {
  switch (task.kind) {
    case "collections.gather":
      return t`Gathering papers…`
    case "collections.more":
      return t`Finding more papers…`
    case "collections.fill": {
      const question = c?.columns.find((col) => col.id === task.subject.split(":")[1])?.question ?? ""
      return t`Asking each paper “${question}”…`
    }
    case "collections.read":
      return t`Reading papers in full…`
    case "collections.check":
      return t`Looking for new papers…`
  }
}

// What the browser preview says when asked for work only core does
export const desktopOnly = () => void toast(t`Owlit works on collections in the desktop app.`)

export async function gather(question: string, size: CollectionSize, project: string): Promise<Collection | undefined> {
  if (!isDesktop) {
    toast(t`Owlit gathers papers in the desktop app.`)
    return undefined
  }
  try {
    const c = await rpc.collections.gather({ question, size, ...(project ? { project } : {}) })
    put(c)
    return c
  } catch (error) {
    toastError(error)
    return undefined
  }
}

export async function startRun(id: string, run: "more" | "read" | "check") {
  if (!isDesktop) return desktopOnly()
  await rpc.collections.run({ id, run }).catch(toastError)
}

export async function askEach(id: string, question: string) {
  if (!isDesktop) return desktopOnly()
  try {
    put(await rpc.collections.ask({ id, question }))
  } catch (error) {
    toastError(error)
  }
}
