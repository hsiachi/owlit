import { t } from "@lingui/core/macro"
import { DialogHeading } from "@/components/info"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Markdown } from "@/features/chat/components/messages/Markdown"
import { closeWhatsNew, useUpdates } from "./store"

// What's new, from the "Updated to" toast: that version's CHANGELOG section, shipped with the app so it
// reads offline
export function WhatsNewDialog() {
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
