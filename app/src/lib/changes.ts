// Taking back a change from core's change log. An undo is itself a change (it undoes the first), so the
// toast that confirms it offers Redo, which undoes the undo, and that one Undo again.

import { t } from "@lingui/core/macro"
import { toast } from "sonner"
import { rpc } from "@/lib/rpc"

export function undoChange(id: string, what: string, redo = false) {
  rpc.changes
    .undo({ id })
    .then(({ change }) =>
      toast(redo ? t`Redone` : t`Undone`, {
        description: what,
        action: { label: redo ? t({ message: "Undo", comment: "verb: take back what was just done" }) : t({ message: "Redo", comment: "verb" }), onClick: () => undoChange(change.id, what, !redo) },
      }),
    )
    .catch((error: Error) => toast.error(error.message))
}
