import { t } from "@lingui/core/macro"
import type { ThreadRead, ThreadEdit, ThreadSummary } from "@owlit/protocol"
import { create } from "zustand"
import { rpc } from "@/lib/rpc"
import { toastError, toastUndo } from "@/lib/toast"
import { shown, summaryOf } from "./lib"

// The threads of the open workspace, whole, by id. Core owns them (.owlit/threads/): the store loads them
// when a workspace opens and takes every change core announces (disk.ts); the user's own changes go to
// core, which answers with the thread as it now is.

interface ThreadsState {
  threads: Record<string, ThreadRead>
  // Whether the workspace's threads have arrived (until then the list says nothing rather than "none")
  loaded: boolean
}

export const useThreadsStore = create<ThreadsState>()(() => ({ threads: {}, loaded: false }))

export const put = (c: ThreadRead) => useThreadsStore.setState((s) => ({ threads: { ...s.threads, [c.id]: c } }))
export const drop = (id: string) =>
  useThreadsStore.setState((s) => {
    const { [id]: _gone, ...rest } = s.threads
    return { threads: rest }
  })

// One of the user's changes (what its table is grouped by). Resolves to whether it was made.
export async function editThread(id: string, edit: ThreadEdit): Promise<boolean> {
  try {
    put(await rpc.threads.edit({ id, edit }))
    return true
  } catch (error) {
    toastError(error)
    return false
  }
}

export async function deleteThread(id: string) {
  const c = useThreadsStore.getState().threads[id]
  if (!c) return
  const title = shown(c).title
  try {
    await rpc.threads.delete({ id })
  } catch (error) {
    toastError(error)
    return
  }
  drop(id)
  toastUndo(t`Thread deleted`, async () => put(await rpc.threads.undelete({ id })), { description: title })
}

// Newest change first
export function useSummaries(): ThreadSummary[] {
  const threads = useThreadsStore((s) => s.threads)
  return Object.values(threads)
    .map(summaryOf)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useThread = (id: string | undefined) => useThreadsStore((s) => (id ? s.threads[id] : undefined))
