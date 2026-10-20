// The open workspace's background tasks as core reports them (tasks.list, then tasks.changed). Only
// listens: features show a task beside its subject (a paper's row, the import line) by reading this
// store; there is no task list of its own. Empty without the desktop app.

import type { Task } from "@owlit/protocol"
import { create } from "zustand"
import { followCore } from "@/lib/follow-core"
import { hasCore, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"

interface TasksState {
  byId: Record<string, Task>
}

export const useTasksStore = create<TasksState>(() => ({ byId: {} }))

// The tasks by subject, built once per byId: byId is replaced on every change and only
// grows (core keeps finished tasks a while), and a list asks for each of its rows' tasks on every change
type TaskIndex = Map<string, Task[]>
const indexes = new WeakMap<Record<string, Task>, TaskIndex>()
const NONE: readonly Task[] = []
function indexOf(byId: Record<string, Task>): TaskIndex {
  let index = indexes.get(byId)
  if (index) return index
  index = new Map()
  for (const task of Object.values(byId)) {
    const list = index.get(task.subject)
    if (list) list.push(task)
    else index.set(task.subject, [task])
  }
  indexes.set(byId, index)
  return index
}

// A subject's tasks, finished ones too. Shared between callers: copy before sorting.
export const tasksFor = (byId: Record<string, Task>, subject: string): readonly Task[] => indexOf(byId).get(subject) ?? NONE

export const cancelTask = (id: string) => rpc.tasks.cancel({ id })

export function startTasks() {
  if (!hasCore) return
  // Changes heard while the list is loading are newer than the list, so they are laid over it
  const follow = followCore({
    read: () => rpc.tasks.list(),
    take: (listed) => useTasksStore.setState({ byId: Object.fromEntries(listed.map((task) => [task.id, task])) }),
  })

  const load = async () => {
    useTasksStore.setState({ byId: {} })
    await follow.load().catch((error: unknown) => console.warn("[owlit] couldn't list tasks", error))
  }

  onNotify("tasks.changed", ({ task }) => follow.hear(() => useTasksStore.setState((state) => ({ byId: { ...state.byId, [task.id]: task } }))))
  onWorkspaceOpened(() => void load())
  // The workspace may have opened before this started
  if (useWorkspace.getState().current) void load()
}
