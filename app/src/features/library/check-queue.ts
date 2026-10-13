import { create } from "zustand"
import { openTasksFor, useTasksStore } from "@/features/tasks/store"
import { useLibraryStore } from "./store"

// Several papers whose publishers want the user, gone through one after another from Home's "Waiting
// on you": each paper's publisher page in turn, the next one opening once a PDF arrives. The order is
// fixed when the run starts; only a page opened with ?queue=1 follows it, so opening one of these
// papers later by hand doesn't carry on a run that ended.
interface CheckQueue {
  ids: string[]
  start(ids: string[]): void
  end(): void
}

export const useCheckQueue = create<CheckQueue>((set) => ({
  ids: [],
  start: (ids) => set({ ids }),
  end: () => set({ ids: [] }),
}))

// The paper after `id` that still waits on the user. One the publisher may now give unattended (core
// retries a publisher's other papers once the user is past it) is left to that.
export function useNextCheck(id: string): string | undefined {
  const ids = useCheckQueue((s) => s.ids)
  const papers = useLibraryStore((s) => s.papers)
  const tasks = useTasksStore()
  const at = ids.indexOf(id)
  if (at < 0) return undefined
  // A paper whose publisher isn't letting owlit in has no check to go through
  return ids
    .slice(at + 1)
    .find((next) => {
      const needs = papers[next]?.noPdf?.needs
      return needs && needs !== "blocked" && !papers[next]?.pdf && !openTasksFor(tasks, next).some((t) => t.kind.startsWith("paper.pdf"))
    })
}
