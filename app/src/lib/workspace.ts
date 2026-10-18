// The workspace core has open. Features that hold workspace data (Docs, Chat, Library, once they are
// backed by core) subscribe with onWorkspaceOpened and reload; until then they keep their mock data.
// Without the desktop app there is no workspace and current stays null.

import { t } from "@lingui/core/macro"
import type { WorkspaceInfo, WorkspaceState } from "@owlit/protocol"
import { create } from "zustand"
import { bridge, isDesktop, onNotify, rpc } from "@/lib/rpc"

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

// Run before the window asks core to open another folder: each sends what it still holds back and
// resolves once it has reached core. An open drops every store's queue, so anything left in one would
// be lost.
const flushers = new Set<() => Promise<unknown>>()

export function beforeWorkspaceSwitch(flush: () => Promise<unknown>) {
  flushers.add(flush)
  return () => {
    flushers.delete(flush)
  }
}

const flushAll = () => Promise.all([...flushers].map((flush) => flush().catch(() => undefined)))

// Runs open (workspace.open, create or createExample) once the open workspace's pending writes have
// reached core
export async function switchWorkspace<T>(open: () => Promise<T>): Promise<T> {
  await flushAll()
  return open()
}

// A switch from the app's File menu goes from main to core, which asks here first
bridge?.onBeforeSwitch(flushAll)

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

// ---- Choosing a workspace: the welcome page and the first launch's last step ----

// "~/Documents" rather than the whole home path
export const tilde = (p: string) => p.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, "~")

// The folder a new workspace goes in; undefined when the picker is cancelled
export async function pickParent(current: string) {
  const folder = await bridge?.chooseFolder({ title: t`Where the Workspace Goes`, buttonLabel: t({ message: "Choose", comment: "button of the folder picker" }), defaultPath: current })
  return folder || undefined
}

// A folder the user has, to open as the workspace; undefined when the picker is cancelled
export async function pickWorkspaceFolder() {
  const folder = await bridge?.chooseFolder({
    title: t`Open a Folder`,
    message: t`Choose the folder owlit works in. Your files stay as they are; owlit keeps its own state in .owlit.`,
    buttonLabel: t({ message: "Open", comment: "button of the folder picker" }),
  })
  return folder || undefined
}
