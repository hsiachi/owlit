import { t } from "@lingui/core/macro"
import { applyCollectionEdit, itemId, shownCollection, type Collection, type CollectionEdit, type CollectionSummary } from "@owlit/protocol"
import { toast } from "sonner"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastUndo } from "@/lib/toast"
import { summaryOf } from "./lib"
import { seedCollections } from "./mocks/seed"

// The collections of the open workspace, whole, by id. Core owns them (.owlit/collections/): in the
// desktop app the store loads them when a workspace opens and takes every change core announces (disk.ts);
// the user's own changes go to core, which answers with the collection as it now is. Without core (the
// browser preview) the store applies them itself, the same way core does (applyCollectionEdit), and keeps
// them in localStorage.

interface CollectionsState {
  collections: Record<string, Collection>
  // Whether the workspace's collections have arrived (until then the list says nothing rather than "none")
  loaded: boolean
}

export const useCollectionsStore = create<CollectionsState>()(
  persist(() => ({ collections: isDesktop ? {} : seedCollections(), loaded: !isDesktop }), {
    name: "owlit-collections",
    version: 1,
    skipHydration: isDesktop,
    partialize: (s) => (isDesktop ? {} : { collections: s.collections }),
  }),
)

export const put = (c: Collection) => useCollectionsStore.setState((s) => ({ collections: { ...s.collections, [c.id]: c } }))
export const drop = (id: string) =>
  useCollectionsStore.setState((s) => {
    const { [id]: _gone, ...rest } = s.collections
    return { collections: rest }
  })

const failed = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))

// One of the user's changes. Resolves to whether it was made.
export async function editCollection(id: string, edit: CollectionEdit): Promise<boolean> {
  if (isDesktop) {
    try {
      put(await rpc.collections.edit({ id, edit }))
      return true
    } catch (error) {
      failed(error)
      return false
    }
  }
  const was = useCollectionsStore.getState().collections[id]
  if (!was) return false
  const c = structuredClone(was)
  const done = applyCollectionEdit(c, edit, Date.now())
  if ("problem" in done) return false
  if (edit.op !== "seen") c.updatedAt = Date.now()
  put(c)
  return true
}

// Removing is immediate and says so with Undo, like every removal in owlit
export async function removeItem(id: string, item: string, label: string) {
  if (await editCollection(id, { op: "remove", item })) toastUndo(label, () => editCollection(id, { op: "unremove", item }))
}

export const removeRow = (id: string, row: string) => removeItem(id, itemId.row(row), t`Removed from the collection`)

export async function deleteCollection(id: string) {
  const c = useCollectionsStore.getState().collections[id]
  if (!c) return
  const title = shownCollection(c).title
  if (isDesktop) {
    try {
      await rpc.collections.delete({ id })
    } catch (error) {
      failed(error)
      return
    }
  }
  drop(id)
  toastUndo(t`Collection deleted`, async () => {
    if (isDesktop) put(await rpc.collections.undelete({ id }))
    else put(c)
  }, { description: title })
}

// Newest change first
export function useSummaries(): CollectionSummary[] {
  const collections = useCollectionsStore((s) => s.collections)
  return Object.values(collections)
    .map(summaryOf)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export const useCollection = (id: string | undefined) => useCollectionsStore((s) => (id ? s.collections[id] : undefined))
