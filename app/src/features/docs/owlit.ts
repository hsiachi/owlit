// Owlit and each doc, as core keeps it (.owlit/docs/owlit.json): whether the user keeps Owlit out of it,
// and Owlit's last look. Read when a doc's header shows, kept current by docs.owlit.

import { t } from "@lingui/core/macro"
import type { DocOwlit } from "@owlit/protocol"
import { useEffect } from "react"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { onWorkspaceOpened } from "@/lib/workspace"

interface DocOwlitState {
  byPath: Record<string, DocOwlit>
}

export const useDocOwlitStore = create<DocOwlitState>(() => ({ byPath: {} }))

const put = (path: string, state: DocOwlit) => useDocOwlitStore.setState((s) => ({ byPath: { ...s.byPath, [path]: state } }))

// A doc's entry, read from core the first time it is asked for (and again after a rename, under its new path)
export function useDocOwlit(path: string): DocOwlit | undefined {
  const state = useDocOwlitStore((s) => s.byPath[path])
  useEffect(() => {
    if (!isDesktop || useDocOwlitStore.getState().byPath[path]) return
    rpc.docs.owlit({ path }).then((got) => put(path, got), () => undefined)
  }, [path])
  return state
}

export function setOwlitOut(path: string, out: boolean) {
  rpc.docs.setOwlitOut({ path, out }).then(
    (state) => put(path, state),
    (error) => toastError(error, out ? t`Couldn't keep Owlit out of this doc.` : t`Couldn't let Owlit back into this doc.`),
  )
}

if (isDesktop) {
  onNotify("docs.owlit", ({ path, state }) => put(path, state))
  onWorkspaceOpened(() => useDocOwlitStore.setState({ byPath: {} }))
}
