import { t } from "@lingui/core/macro"
import { collectionOfSubject, COLLECTION_RUNS, isTaskFinished, type Collection, type CollectionRun, type CollectionSize, type Task } from "@owlit/protocol"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { useTasksStore } from "@/features/tasks/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { put } from "./store"

// Owlit's work on a collection in the background, read from the tasks core reports: what runs now, and
// a run that broke since, so the collection can say so where the user looks

const isRun = (task: Task): task is Task & { kind: CollectionRun } => (COLLECTION_RUNS as readonly string[]).includes(task.kind)

export interface CollectionWork {
  running: (Task & { kind: CollectionRun })[]
  // The last run that failed, while nothing has run since
  broken?: Task & { kind: CollectionRun }
}

export function useCollectionWork(id: string): CollectionWork {
  const tasks = useTasksStore(useShallow((s) => Object.values(s.byId).filter((task) => isRun(task) && collectionOfSubject(task.subject) === id))) as (Task & { kind: CollectionRun })[]
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

const failed = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))

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
    failed(error)
    return undefined
  }
}

export async function startRun(id: string, run: "more" | "read" | "check") {
  if (!isDesktop) return void toast(t`Owlit works on collections in the desktop app.`)
  await rpc.collections.run({ id, run }).catch(failed)
}

export async function askEach(id: string, question: string) {
  if (!isDesktop) return void toast(t`Owlit works on collections in the desktop app.`)
  try {
    put(await rpc.collections.ask({ id, question }))
  } catch (error) {
    failed(error)
  }
}
