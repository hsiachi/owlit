import { t } from "@lingui/core/macro"
import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { DialogHeading } from "@/components/info"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { rpc } from "@/lib/rpc"
import { closeWhatsNew, openWhatsNew, restartToUpdate, useUpdates } from "./store"

// How long "Updated to" waits once the workspace's window is up, so it doesn't land while it settles
const SETTLE_MS = 2_000

// The update notices, drawn inside the workspace's window (Shell), where toasts show: the welcome page
// has none, and a notice said there would be lost. A downloaded update says so once, and installs on quit
// if nobody restarts. The first start of a newer version says "Updated to" once, with What's new, and only
// then tells core it was seen.
export function UpdateNotices() {
  const view = useUpdates((s) => s.view)
  const told = useRef<string | null>(null)
  const status = view?.status
  const ready = status?.kind === "ready" ? status.version : null
  useEffect(() => {
    if (!ready || told.current === ready) return
    told.current = ready
    toast(t`Owlit ${ready} is ready`, {
      description: t`It installs when you quit Owlit.`,
      action: { label: t({ message: "Restart", comment: "a button: restart Owlit to install the update" }), onClick: () => void restartToUpdate() },
      duration: 20_000,
    })
  }, [ready])

  const updated = view?.updated
  useEffect(() => {
    if (!updated) return
    const timer = setTimeout(() => {
      useUpdates.setState({ whatsNew: updated })
      const version = updated.version
      toast(t`Updated to ${version}`, { action: updated.notes ? { label: t`What's new`, onClick: openWhatsNew } : undefined, duration: 12_000 })
      rpc.updates.seen().catch((error) => console.warn("[owlit] couldn't mark the update as seen", error))
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [updated])

  return <WhatsNewDialog />
}

// What's new: the version's CHANGELOG section, shipped with the app so it reads offline
function WhatsNewDialog() {
  const open = useUpdates((s) => s.whatsNewOpen)
  const note = useUpdates((s) => s.whatsNew)
  if (!note?.notes) return null
  const version = note.version
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeWhatsNew()}>
      <DialogContent className="max-h-[min(40rem,calc(100svh-4rem))] gap-0 overflow-y-auto sm:max-w-lg">
        <DialogHeading title={t`What's new in Owlit ${version}`} description={t`The changes in this version`} />
        <Markdown text={note.notes} className="mt-3 text-sm" />
      </DialogContent>
    </Dialog>
  )
}
