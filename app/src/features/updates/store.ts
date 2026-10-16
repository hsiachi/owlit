// Owlit updating itself, as core reports it (updates.get, then updates.changed): the Settings rows and
// the window's notices (UpdateNotices) read it.

import type { UpdatedNote, UpdatesView } from "@owlit/protocol"
import { t } from "@lingui/core/macro"
import { toast } from "sonner"
import { create } from "zustand"
import { bridge, isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"

interface UpdatesState {
  view: UpdatesView | null
  // The notes What's new shows, kept once core has forgotten them (updates.seen)
  whatsNew: UpdatedNote | null
  whatsNewOpen: boolean
}

export const useUpdates = create<UpdatesState>(() => ({ view: null, whatsNew: null, whatsNewOpen: false }))

export const openWhatsNew = () => useUpdates.setState({ whatsNewOpen: true })
export const closeWhatsNew = () => useUpdates.setState({ whatsNewOpen: false })

export const restartToUpdate = () => bridge?.restartToUpdate().catch(toastError)

export async function checkForUpdates() {
  const found = await rpc.updates.check()
  if (found.kind === "current") toast(t`You're up to date`, { description: t`Owlit ${found.version} is the newest version.` })
}

export const setAutoUpdate = async (auto: boolean) => receive(await rpc.updates.setAuto({ auto }))

function receive(view: UpdatesView) {
  useUpdates.setState({ view })
}

export function startUpdates() {
  if (!isDesktop) return
  onNotify("updates.changed", receive)
  rpc.updates
    .get()
    .then(receive)
    .catch((error) => console.warn("[owlit] couldn't read updates", error))
}
