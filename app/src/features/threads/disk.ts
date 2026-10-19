import type { Thread } from "@owlit/protocol"
import { followCore } from "@/lib/follow-core"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { drop, put, useThreadsStore } from "./store"

// In the desktop app the threads live in the workspace (.owlit/threads/): the store loads them
// when a workspace opens and takes what core says changed (an agent's write, an undo, another window).

if (isDesktop) {
  // A change heard while the threads are read is laid over them once they arrive
  const follow = followCore({
    read: async () => {
      const list = await rpc.threads.list().catch(() => [])
      const all = await Promise.all(list.map((c) => rpc.threads.get({ id: c.id }).catch(() => null)))
      return all.filter((c): c is Thread => !!c)
    },
    take: (threads) => useThreadsStore.setState({ threads: Object.fromEntries(threads.map((c) => [c.id, c])), loaded: true }),
  })

  onWorkspaceOpened(() => {
    useThreadsStore.setState({ threads: {}, loaded: false })
    void follow.load()
  })

  onNotify("threads.changed", ({ id, thread }) => follow.hear(() => (thread ? put(thread) : drop(id))))
}
