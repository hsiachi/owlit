// A note, paper, thread or line of memory an agent in a chat changed over owlit-mcp, said in a toast with Undo. An agent's
// doc edits have their own toast (docs/fs.ts), from the editor when the doc is open.

import { t } from "@lingui/core/macro"
import type { Notifications } from "@owlit/protocol"
import { chatOnScreen } from "@/features/chat/results"
import { isDesktop, onNotify } from "@/lib/rpc"
import { toastUndo } from "@/lib/toast"
import { undoChange } from "@/lib/versions"

const titles = (): Record<Notifications["agent.changed"]["kind"], string> => ({
  note: t`Note added`,
  paper: t`Paper added`,
  thread: t`Papers collected`,
  memory: t({ message: "Remembered", comment: "a toast: Owlit now keeps a line in mind about the user" }),
})

export function startAgentChanges() {
  if (!isDesktop) return
  onNotify("agent.changed", ({ kind, op, versionId, label, chatId }) => {
    // A chat on screen says it in its own result row, with the same Undo
    if (chatOnScreen(chatId)) return
    const title =
      kind === "memory"
        ? op === "removed"
          ? t({ message: "No longer kept in mind", comment: "a toast: Owlit removed a line from what it keeps in mind" })
          : op === "updated"
            ? t({ message: "Remembered, replacing a line", comment: "a toast: Owlit changed a line it keeps in mind" })
            : titles().memory
        : op === "removed"
          ? t`Paper removed`
          : titles()[kind]
    toastUndo(title, () => undoChange(versionId, label), { description: label })
  })
}
