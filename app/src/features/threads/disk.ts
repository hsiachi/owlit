import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { drop, put, useThreadsStore } from "./store"

// In the desktop app the threads live in the workspace (.owlit/threads/): the store loads them
// when a workspace opens and takes what core says changed (an agent's write, an undo, another window).

if (isDesktop) {
  onWorkspaceOpened(async () => {
    useThreadsStore.setState({ threads: {}, loaded: false })
    const list = await rpc.threads.list().catch(() => [])
    const all = await Promise.all(list.map((c) => rpc.threads.get({ id: c.id }).catch(() => null)))
    useThreadsStore.setState({ threads: Object.fromEntries(all.filter((c) => !!c).map((c) => [c.id, c])), loaded: true })
  })

  onNotify("threads.changed", ({ id, thread }) => (thread ? put(thread) : drop(id)))
}
