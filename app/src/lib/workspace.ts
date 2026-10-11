// The workspace core has open. Features that hold workspace data (Docs, Chat, Library, once they are
// backed by core) subscribe with onWorkspaceOpened and reload; until then they keep their mock data.
// Without the desktop app there is no workspace and current stays null.

import type { WorkspaceInfo, WorkspaceState } from "@owlit/protocol"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"

interface WorkspaceStore {
  current: WorkspaceInfo | null
  // A workspace is opening (at launch, the last one): the window waits for it
  opening: boolean
  // Core has said whether a workspace is open; until then the window draws nothing rather than flash
  // the welcome page
  known: boolean
}

export const useWorkspace = create<WorkspaceStore>(() => ({ current: null, opening: false, known: !isDesktop }))

// The welcome page shows only in the desktop app, once core has said nothing is open or opening
export const useNeedsWelcome = () => useWorkspace((s) => isDesktop && s.known && !s.current && !s.opening)

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

function state({ current, opening }: WorkspaceState) {
  useWorkspace.setState({ opening, known: true })
  if (current) opened(current)
}

export function startWorkspace() {
  if (!isDesktop) return
  onNotify("workspace.opened", opened)
  onNotify("workspace.state", state)
  // Core may have opened it before this window was listening
  void rpc.workspace.state().then(state)
}
