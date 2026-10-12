// A note, paper or topic an agent in a chat changed over owlit-mcp, said in a toast with Undo. An agent's
// doc edits have their own toast (docs/fs.ts), from the editor when the doc is open.

import type { Notifications } from "@owlit/protocol"
import { chatOnScreen } from "@/features/chat/results"
import { isDesktop, onNotify } from "@/lib/rpc"
import { toastUndo } from "@/lib/toast"
import { undoChange } from "@/lib/versions"

const TITLES: Record<Notifications["agent.changed"]["kind"], string> = {
  note: "Note added",
  paper: "Paper added",
  knowledge: "Knowledge updated",
}

export function startAgentChanges() {
  if (!isDesktop) return
  onNotify("agent.changed", ({ kind, op, versionId, label, chatId }) => {
    // A chat on screen says it in its own result row, with the same Undo
    if (chatOnScreen(chatId)) return
    toastUndo(op === "removed" ? "Paper removed" : TITLES[kind], () => undoChange(versionId, label), { description: label })
  })
}
