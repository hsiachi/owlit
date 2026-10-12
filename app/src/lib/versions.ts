// Taking back what an agent changed. Every agent change core makes (a doc or topic written, a note left,
// a paper added) is kept as a version; Undo restores it, and the undo is itself kept, so the toast that
// confirms it offers Redo, and that one Undo again.

import { toast } from "sonner"
import { rpc } from "@/lib/rpc"

export function undoChange(versionId: string, what: string, redo = false) {
  rpc.versions
    .restore({ id: versionId })
    .then(({ redoId }) =>
      toast(redo ? "Redone" : "Undone", {
        description: what,
        action: { label: redo ? "Undo" : "Redo", onClick: () => undoChange(redoId, what, !redo) },
      }),
    )
    .catch((error: Error) => toast.error(error.message))
}
