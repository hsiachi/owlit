// Taking back what an agent changed. Every agent change core makes (a doc or topic written, a note left,
// a paper added) is kept as a version; Undo restores it, and the undo is itself kept, so the toast that
// confirms it offers Redo, and that one Undo again.

import type { Notifications } from "@owlit/protocol"
import { toast } from "sonner"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { chatOnScreen } from "@/features/chat/results"

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

const TITLES: Record<Notifications["agent.changed"]["kind"], string> = {
  note: "Note added",
  paper: "Paper added",
  knowledge: "Knowledge updated",
}

// A note, paper or topic an agent in a chat changed over owlit-mcp. An agent's doc edits have their own
// toast (docs/fs.ts), from the editor when the doc is open.
if (isDesktop) {
  onNotify("agent.changed", ({ kind, op, versionId, label, chatId }) => {
    // A chat on screen says it in its own result row, with the same Undo
    if (chatOnScreen(chatId)) return
    toast(op === "removed" ? "Paper removed" : TITLES[kind], { description: label, action: { label: "Undo", onClick: () => undoChange(versionId, label) } })
  })
}
