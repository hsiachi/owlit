// The dial for Owlit on its own, as the open workspace keeps it (.owlit/workspace.json): read when
// Settings shows it, kept current by initiative.changed, and the same for every window.

import { INITIATIVE_DEFAULTS, type InitiativeSettings } from "@owlit/protocol"
import { useEffect } from "react"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { onWorkspaceOpened } from "@/lib/workspace"

export const useInitiative = create<{ settings: InitiativeSettings | null }>(() => ({ settings: null }))

export function useInitiativeSettings(): InitiativeSettings {
  const settings = useInitiative((s) => s.settings)
  useEffect(() => {
    if (isDesktop && !useInitiative.getState().settings) rpc.initiative.get().then((got) => useInitiative.setState({ settings: got }), () => undefined)
  }, [])
  return settings ?? INITIATIVE_DEFAULTS
}

export function setInitiative(patch: Partial<InitiativeSettings>) {
  rpc.initiative.set({ patch }).then((settings) => useInitiative.setState({ settings }), toastError)
}

if (isDesktop) {
  onNotify("initiative.changed", (settings) => useInitiative.setState({ settings }))
  onWorkspaceOpened(() => useInitiative.setState({ settings: null }))
}
