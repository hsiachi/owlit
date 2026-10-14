// A note, paper, topic or collection an agent in a chat changed over owlit-mcp, said in a toast with Undo. An agent's
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
  knowledge: t`Knowledge updated`,
  collection: t`Papers collected`,
})

export function startAgentChanges() {
  if (!isDesktop) return
  onNotify("agent.changed", ({ kind, op, versionId, label, chatId }) => {
    // A chat on screen says it in its own result row, with the same Undo
    if (chatOnScreen(chatId)) return
    toastUndo(op === "removed" ? t`Paper removed` : titles()[kind], () => undoChange(versionId, label), { description: label })
  })
}
