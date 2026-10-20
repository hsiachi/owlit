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

// Several entries taken back in the order given (newest first, so each finds the text the next left), as
// one Undo; its Redo takes the undos back in the opposite order
export async function undoAll(ids: string[], what: string, redo = false) {
  const undos: string[] = []
  const left: string[] = []
  try {
    for (const id of ids) {
      const done = await rpc.changes.undo({ id })
      undos.unshift(done.change.id)
      left.push(...(done.left ?? []))
    }
  } catch (error) {
    toast.error((error as Error).message)
    if (!undos.length) return
  }
  if (left.length) toastLeft(what, left)
  toast(redo ? t`Redone` : t`Undone`, {
    description: what,
    action: { label: redo ? t({ message: "Undo", comment: "verb: take back what was just done" }) : t({ message: "Redo", comment: "verb" }), onClick: () => void undoAll(undos, what, !redo) },
  })
}
