import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { drop, put, useCollectionsStore } from "./store"

// In the desktop app the collections live in the workspace (.owlit/collections/): the store loads them
// when a workspace opens and takes what core says changed (an agent's write, an undo, another window).

if (isDesktop) {
  onWorkspaceOpened(async () => {
    useCollectionsStore.setState({ collections: {}, loaded: false })
    const list = await rpc.collections.list().catch(() => [])
    const all = await Promise.all(list.map((c) => rpc.collections.get({ id: c.id }).catch(() => null)))
    useCollectionsStore.setState({ collections: Object.fromEntries(all.filter((c) => !!c).map((c) => [c.id, c])), loaded: true })
  })

  onNotify("collections.changed", ({ id, collection }) => (collection ? put(collection) : drop(id)))
}
