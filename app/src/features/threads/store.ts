import { t } from "@lingui/core/macro"
import { applyThreadEdit, itemId, upgradeThread, type Thread, type ThreadEdit, type ThreadSummary } from "@owlit/protocol"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError, toastUndo } from "@/lib/toast"
import { shown, summaryOf } from "./lib"
import { seedThreads } from "./mocks/seed"

// The threads of the open workspace, whole, by id. Core owns them (.owlit/threads/): in the
// desktop app the store loads them when a workspace opens and takes every change core announces (disk.ts);
// the user's own changes go to core, which answers with the thread as it now is. Without core (the
// browser preview) the store applies them itself, the same way core does (applyThreadEdit), and keeps
// them in localStorage.

interface ThreadsState {
  threads: Record<string, Thread>
  // Whether the workspace's threads have arrived (until then the list says nothing rather than "none")
  loaded: boolean
}

export const useThreadsStore = create<ThreadsState>()(
  persist(() => ({ threads: isDesktop ? {} : seedThreads(), loaded: !isDesktop }), {
    name: "owlit-threads",
    // 2: groupings are columns (upgradeThread)
    version: 2,
    migrate: (kept) => {
      const threads = (kept as { threads?: Record<string, Parameters<typeof upgradeThread>[0]> } | undefined)?.threads ?? {}
      return { threads: Object.fromEntries(Object.entries(threads).map(([id, c]) => [id, upgradeThread(c)])) }
    },
    skipHydration: isDesktop,
    partialize: (s) => (isDesktop ? {} : { threads: s.threads }),
  }),
)

export const put = (c: Thread) => useThreadsStore.setState((s) => ({ threads: { ...s.threads, [c.id]: c } }))
export const drop = (id: string) =>
  useThreadsStore.setState((s) => {
    const { [id]: _gone, ...rest } = s.threads
    return { threads: rest }
  })

// One of the user's changes. Resolves to whether it was made.
export async function editThread(id: string, edit: ThreadEdit): Promise<boolean> {
  if (isDesktop) {
    try {
      put(await rpc.threads.edit({ id, edit }))
      return true
    } catch (error) {
      toastError(error)
      return false
    }
  }
  const was = useThreadsStore.getState().threads[id]
  if (!was) return false
  const c = structuredClone(was)
  const done = applyThreadEdit(c, edit, Date.now())
  if ("problem" in done) return false
  if (edit.op !== "seen" && edit.op !== "view") c.updatedAt = Date.now()
  put(c)
  return true
}

// A paper into or out of a group. What takes it out of one says so with Undo (undo), which puts the user's
// earlier placements of that paper in that grouping back as they were.
export async function regroupRow(c: Thread, edit: Extract<ThreadEdit, { op: "place" | "move" }>, undo?: string) {
  const prefix = `${edit.column}:${edit.row}:`
  const groups = c.columns.find((col) => col.id === edit.column)?.groups ?? []
  const placed = Object.fromEntries(groups.map((g) => [g.id, c.yours.placed[`${prefix}${g.id}`] ?? null]))
  if ((await editThread(c.id, edit)) && undo) toastUndo(undo, () => editThread(c.id, { op: "unplace", column: edit.column, row: edit.row, placed }))
}

// Removing is immediate and says so with Undo, like every removal in owlit
export async function removeItem(id: string, item: string, label: string) {
  if (await editThread(id, { op: "remove", item })) toastUndo(label, () => editThread(id, { op: "unremove", item }))
}

export const removeRow = (id: string, row: string) => removeItem(id, itemId.row(row), t`Removed from the thread`)

export async function deleteThread(id: string) {
  const c = useThreadsStore.getState().threads[id]
  if (!c) return
  const title = shown(c).title
  if (isDesktop) {
    try {
      await rpc.threads.delete({ id })
    } catch (error) {
      toastError(error)
      return
    }
  }
  drop(id)
  toastUndo(t`Thread deleted`, async () => {
    if (isDesktop) put(await rpc.threads.undelete({ id }))
    else put(c)
  }, { description: title })
}

// Newest change first
export function useSummaries(): ThreadSummary[] {
  const threads = useThreadsStore((s) => s.threads)
  return Object.values(threads)
    .map(summaryOf)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useThread = (id: string | undefined) => useThreadsStore((s) => (id ? s.threads[id] : undefined))
