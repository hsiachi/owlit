import { t } from "@lingui/core/macro"
import { applyThreadEdit, itemId, type ThreadRead, type ThreadEdit, type ThreadSummary } from "@owlit/protocol"
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
  threads: Record<string, ThreadRead>
  // Whether the workspace's threads have arrived (until then the list says nothing rather than "none")
  loaded: boolean
}

export const useThreadsStore = create<ThreadsState>()(
  persist(() => ({ threads: isDesktop ? {} : seedThreads(), loaded: !isDesktop }), {
    name: "owlit-threads",
    // 3: a thread is a report plus Library papers. The preview's threads kept by an older version start
    // again from the seed: their rows held the papers' facts, which only core can give a version 3 thread.
    version: 3,
    migrate: () => ({ threads: seedThreads() }),
    skipHydration: isDesktop,
    partialize: (s) => (isDesktop ? {} : { threads: s.threads }),
  }),
)

export const put = (c: ThreadRead) => useThreadsStore.setState((s) => ({ threads: { ...s.threads, [c.id]: c } }))
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
  if (edit.op !== "view") c.updatedAt = Date.now()
  put(c)
  return true
}

// One of the user's changes, said with Undo (label), which takes back the change log's entries the change
// made; in the browser preview, which has no log, it puts the thread back as it was
export async function editWithUndo(id: string, edit: ThreadEdit, label: string) {
  const was = useThreadsStore.getState().threads[id]
  const since = Date.now()
  if (!(await editThread(id, edit))) return
  toastUndo(label, async () => {
    if (!isDesktop) {
      if (was) put(was)
      return
    }
    try {
      // Newest first; one change's entries share a writeId
      const entries = (await rpc.changes.list({ path: id, since })).filter((c) => c.target.kind === "thread" && !c.undoes)
      const writeId = entries[0]?.origin.writeId
      for (const e of entries.filter((c) => c.origin.writeId === writeId)) await rpc.changes.undo({ id: e.id })
    } catch (error) {
      toastError(error)
    }
  })
}

// A paper into or out of a group. What takes it out of one says so with Undo (undo).
export async function regroupRow(c: ThreadRead, edit: Extract<ThreadEdit, { op: "place" | "move" }>, undo?: string) {
  if (undo) await editWithUndo(c.id, edit, undo)
  else await editThread(c.id, edit)
}

// Removing is immediate and says so with Undo, like every removal in owlit
export const removeItem = (id: string, item: string, label: string) => editWithUndo(id, { op: "remove", item }, label)

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
