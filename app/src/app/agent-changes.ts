// A comment, paper, thread or line of memory an agent in a chat changed over owlit-mcp, said in a toast with Undo. An agent's
// doc edits have their own toast (docs/fs.ts), from the editor when the doc is open.

import { t } from "@lingui/core/macro"
import { isOwlit, type Change } from "@owlit/protocol"
import { chatOnScreen } from "@/features/chat/results"
import { onNotify } from "@/lib/rpc"
import { toastUndo } from "@/lib/toast"
import { undoChange } from "@/lib/changes"

function titleOf({ target, action }: Change) {
  switch (target.kind) {
    case "memory":
      return action === "delete"
        ? t({ message: "No longer kept in mind", comment: "a toast: Owlit removed a line from what it keeps in mind" })
        : action === "update"
          ? t({ message: "Remembered, replacing a line", comment: "a toast: Owlit changed a line it keeps in mind" })
          : t({ message: "Remembered", comment: "a toast: Owlit now keeps a line in mind about the user" })
    case "paper":
      return action === "delete" ? t`Paper removed` : t`Paper added`
    case "comment":
      return t`Comment added`
    case "thread":
      return t`Papers collected`
    default:
      return undefined
  }
}

export function startAgentChanges() {
  onNotify("changes.added", ({ change, label }) => {
    // Owlit's changes only (an undo is the person's); a chat on screen says it in its own result row,
    // with the same Undo
    if (!isOwlit(change.actor) || change.undoes || chatOnScreen(change.origin.chatId)) return
    const title = titleOf(change)
    const what = label ?? change.target.path
    if (title) toastUndo(title, () => undoChange(change.id, what), { description: what })
  })
}
