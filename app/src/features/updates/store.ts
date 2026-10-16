// Owlit updating itself, as core reports it (updates.get, then updates.changed): the Settings rows read
// it, and two toasts come from it. A downloaded update says so once, and installs on quit if nobody
// restarts; the first start of a newer version says "Updated to" once, with what's new.

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

// How long "Updated to" waits after the window loads, so it doesn't land while the workspace opens
const SETTLE_MS = 2_000

function receive(view: UpdatesView) {
  const before = useUpdates.getState().view
  useUpdates.setState({ view })
  const s = view.status
  const was = before?.status
  if (s.kind === "ready" && !(was?.kind === "ready" && was.version === s.version)) {
    toast(t`Owlit ${s.version} is ready`, {
      description: t`It installs when you quit Owlit.`,
      action: { label: t({ message: "Restart", comment: "a button: restart Owlit to install the update" }), onClick: () => void restartToUpdate() },
      duration: 20_000,
    })
  }
  const updated = view.updated
  if (updated && !useUpdates.getState().whatsNew) {
    useUpdates.setState({ whatsNew: updated })
    setTimeout(() => {
      toast(t`Updated to ${updated.version}`, {
        action: updated.notes ? { label: t`What's new`, onClick: openWhatsNew } : undefined,
        duration: 12_000,
      })
      rpc.updates.seen().catch((error) => console.warn("[owlit] couldn't mark the update as seen", error))
    }, SETTLE_MS)
  }
}

export function startUpdates() {
  if (!isDesktop) return
  onNotify("updates.changed", receive)
  rpc.updates
    .get()
    .then(receive)
    .catch((error) => console.warn("[owlit] couldn't read updates", error))
}
