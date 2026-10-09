// The workspace core has open. Features that hold workspace data (Docs, Chat, Library, once they are
// backed by core) subscribe with onWorkspaceOpened and reload; until then they keep their mock data.
// Without the desktop app there is no workspace and current stays null.

import type { WorkspaceInfo } from "@owlit/protocol"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"

interface WorkspaceState {
  current: WorkspaceInfo | null
}

export const useWorkspace = create<WorkspaceState>(() => ({ current: null }))

type Listener = (workspace: WorkspaceInfo) => void
const listeners = new Set<Listener>()

// Called after every open, including a switch to another folder; returns an unsubscribe
export function onWorkspaceOpened(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function opened(workspace: WorkspaceInfo) {
  if (useWorkspace.getState().current?.path === workspace.path) return
  useWorkspace.setState({ current: workspace })
  for (const listener of listeners) listener(workspace)
}

if (isDesktop) {
  onNotify("workspace.opened", opened)
  // Core may have opened it before this window was listening
  void rpc.workspace.current().then((workspace) => workspace && opened(workspace))
}
