// The open workspace's background tasks as core reports them (tasks.list, then tasks.changed). Only
// listens: features show a task beside its subject (a paper's row, the import line) by reading this
// store; there is no task list of its own. Empty without the desktop app.

import { isTaskFinished, TASK_PRIORITIES, type Task } from "@owlit/protocol"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"

interface TasksState {
  byId: Record<string, Task>
}

export const useTasksStore = create<TasksState>(() => ({ byId: {} }))

// A subject's unfinished tasks, most urgent first, then oldest
export function openTasksFor(state: TasksState, subject: string) {
  const rank = (task: Task) => TASK_PRIORITIES.indexOf(task.priority)
  return Object.values(state.byId)
    .filter((task) => task.subject === subject && !isTaskFinished(task))
    .sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt)
}

// Fetches stopped at the library proxy's sign-in page, waiting for the user to sign in
const isLoginTask = (task: Task) => task.state === "waiting_for_you" && task.waiting?.reason === "login"
export const useLoginTasks = () => useTasksStore(useShallow((s) => Object.values(s.byId).filter(isLoginTask)))

export const cancelTask = (id: string) => rpc.tasks.cancel({ id })
export const resumeTask = (id: string) => rpc.tasks.resume({ id })

export function startTasks() {
  if (!isDesktop) return
  // Changes heard while the list is loading are newer than the list
  let heard: Map<string, Task> | null = null

  const load = async () => {
    heard = new Map()
    useTasksStore.setState({ byId: {} })
    try {
      const listed = await rpc.tasks.list()
      const byId: Record<string, Task> = Object.fromEntries(listed.map((task) => [task.id, task]))
      for (const [id, task] of heard) byId[id] = task
      useTasksStore.setState({ byId })
    } catch (error) {
      console.warn("[owlit] couldn't list tasks", error)
    } finally {
      heard = null
    }
  }

  onNotify("tasks.changed", ({ task }) => {
    heard?.set(task.id, task)
    useTasksStore.setState((state) => ({ byId: { ...state.byId, [task.id]: task } }))
  })
  onWorkspaceOpened(() => void load())
  // The workspace may have opened before this started
  if (useWorkspace.getState().current) void load()
}
