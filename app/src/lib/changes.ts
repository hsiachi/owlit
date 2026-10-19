// Taking back a change from core's change log. An undo is itself a change (it undoes the first), so the
// toast that confirms it offers Redo, which undoes the undo, and that one Undo again.

import { t } from "@lingui/core/macro"
import { toast } from "sonner"
import { rpc } from "@/lib/rpc"

// An undo of a doc's change that left some passages as they were, since they were edited after it
export function toastLeft(what: string, left: string[]) {
  const passages = left.map((p) => `“${p.length > 60 ? `${p.slice(0, 60)}…` : p}”`).join(", ")
  toast(t({ message: "Some passages were edited since and stay as they are", comment: "after undoing a change to a doc" }), { description: `${what}: ${passages}` })
}

export function undoChange(id: string, what: string, redo = false) {
  rpc.changes
    .undo({ id })
    .then(({ change, left }) => {
      if (left?.length) toastLeft(what, left)
      toast(redo ? t`Redone` : t`Undone`, {
        description: what,
        action: { label: redo ? t({ message: "Undo", comment: "verb: take back what was just done" }) : t({ message: "Redo", comment: "verb" }), onClick: () => undoChange(change.id, what, !redo) },
      })
    })
    .catch((error: Error) => toast.error(error.message))
}
