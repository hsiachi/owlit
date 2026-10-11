import { parseOwlitUri } from "@owlit/protocol"
import { setWorkspaceKnowledge } from "@/features/chat/agent/client"
import { reviseLine } from "./runner"
import { getTopic } from "./store"

// Serves Knowledge to agents: one line revised from what the user said. Each revision's undo is kept by its
// tool call, so the chat's "Updated" line can take it back.
const undos = new Map<string, () => void>()

export const undoRevision = (callId: string) => {
  const undo = undos.get(callId)
  undos.delete(callId)
  undo?.()
  return !!undo
}

export const canUndoRevision = (callId: string) => undos.has(callId)

setWorkspaceKnowledge({
  reviseLine({ uri, said, chatId, callId }) {
    const u = parseOwlitUri(uri)
    if (u?.kind !== "knowledge" || !u.block) return null
    const { topicId } = u
    const r = reviseLine(topicId, u.block, said, chatId)
    const t = getTopic(topicId)
    if (!r || !t) return null
    const changed = r.how !== "none"
    if (changed) undos.set(callId, r.undo)
    const line = t.lines[r.position - 1]
    const text = r.how === "condition" ? [line.text, line.condition].filter(Boolean).join(" ") : line.text
    return { path: t.path, topic: t.name, position: r.position, words: r.words, text, changed, how: r.how }
  },
})
