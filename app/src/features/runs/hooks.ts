import { t } from "@lingui/core/macro"
import { isTaskFinished, threadOfSubject, type Task } from "@owlit/protocol"
import { useShallow } from "zustand/react/shallow"
import { useAgentWindow } from "@/features/agent/store"
import { useLibraryStore } from "@/features/library/store"
import { tasksOfKind, useTasksStore } from "@/features/tasks/store"
import { useThreadsStore } from "@/features/threads/store"
import { loadRun } from "./store"

// Opens a run's session in the Owlit panel
export async function openRun(chatId: string) {
  await loadRun(chatId)
  useAgentWindow.getState().showChat(chatId)
}

// What a run is doing, in Owlit's words: core's line once the run has started, else the same line made
// here from what it waits to work on
export function useDoingLine(task: Task | undefined): string {
  const paperTitle = useLibraryStore((s) => (task?.kind === "paper.digest" ? s.papers[task.subject]?.title : undefined))
  const threadTitle = useThreadsStore((s) => (task?.kind.startsWith("threads.") ? s.threads[threadOfSubject(task.subject)]?.title : undefined))
  if (task?.doing) return task.doing
  // Named as core names them, so both say the same words
  const title = paperTitle ?? threadTitle
  if (task?.kind === "paper.digest" && title) return t`Writing the digest of “${title}”`
  if (task?.kind === "threads.check" && title) return t`Checking “${title}” for new papers`
  if (title) return t`Working on “${title}”`
  return t`Working in the background`
}

// The open runs of these kinds on a subject (a paper id; a thread id, whose column runs count too),
// the one at work first. One waiting on the user isn't working: it has its own amber.
export function useOpenRuns(subject: string, kinds: readonly string[]): Task[] {
  return useTasksStore(
    useShallow((s) =>
      kinds
        .flatMap((kind) => tasksOfKind(s.byId, kind))
        .filter((task) => !isTaskFinished(task) && task.state !== "waiting_for_you" && (task.subject === subject || threadOfSubject(task.subject) === subject))
        .sort((a, b) => (a.state === b.state ? a.createdAt - b.createdAt : a.state === "running" ? -1 : 1)),
    ),
  )
}
