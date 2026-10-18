// The open workspace's background tasks as core reports them (tasks.list, then tasks.changed). Only
// listens: features show a task beside its subject (a paper's row, the import line) by reading this
// store; there is no task list of its own. Empty without the desktop app.

import { isTaskFinished, TASK_PRIORITIES, type Task } from "@owlit/protocol"
import { create } from "zustand"
import { followCore } from "@/lib/follow-core"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"

interface TasksState {
  byId: Record<string, Task>
}

export const useTasksStore = create<TasksState>(() => ({ byId: {} }))

// The tasks by subject and by kind, built once per byId: byId is replaced on every change and only
// grows (core keeps finished tasks a while), and a list asks for each of its rows' tasks on every change
type TaskIndex = { bySubject: Map<string, Task[]>; byKind: Map<string, Task[]> }
const indexes = new WeakMap<Record<string, Task>, TaskIndex>()
const NONE: readonly Task[] = []
function indexOf(byId: Record<string, Task>): TaskIndex {
  let index = indexes.get(byId)
  if (index) return index
  index = { bySubject: new Map(), byKind: new Map() }
  const add = (map: Map<string, Task[]>, key: string, task: Task) => {
    const list = map.get(key)
    if (list) list.push(task)
    else map.set(key, [task])
  }
  for (const task of Object.values(byId)) {
    add(index.bySubject, task.subject, task)
    add(index.byKind, task.kind, task)
  }
  indexes.set(byId, index)
  return index
}

// A subject's tasks, or every task of a kind, finished ones too. Shared between callers: copy before sorting.
export const tasksFor = (byId: Record<string, Task>, subject: string): readonly Task[] => indexOf(byId).bySubject.get(subject) ?? NONE
export const tasksOfKind = (byId: Record<string, Task>, kind: string): readonly Task[] => indexOf(byId).byKind.get(kind) ?? NONE

// A subject's unfinished tasks, most urgent first, then oldest
export function openTasksFor(state: TasksState, subject: string) {
  const rank = (task: Task) => TASK_PRIORITIES.indexOf(task.priority)
  return tasksFor(state.byId, subject)
    .filter((task) => !isTaskFinished(task))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
}

export const cancelTask = (id: string) => rpc.tasks.cancel({ id })
export const resumeTask = (id: string) => rpc.tasks.resume({ id })

export function startTasks() {
  if (!isDesktop) return
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
