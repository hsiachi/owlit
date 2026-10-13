import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { t } from "@lingui/core/macro"
import { KIND_ICON } from "@/lib/kinds"
import type { MessagePart, ToolCall } from "@/features/chat/types"
import type { ResultRow } from "@/features/chat/components/messages/ResultRows"
import { canUndoRevision, undoRevision } from "../agent"
import { allTopics } from "../store"


const isKnowledgeEdit = (p: MessagePart): p is ToolCall =>
  p.type === "tool_call" && p.kind === "edit" && p.status === "completed" && !!p.locations?.[0]?.path.startsWith("knowledge/")

// The rows an answer that changed Knowledge adds to its result card: the topic, "Updated", opening on the
// line. A correction made in chat lands the same way as one made on the topic page: one line changes.
export function useKnowledgeRows(parts: MessagePart[]): ResultRow[] {
  const navigate = useNavigate()
  const [undone, setUndone] = useState<Record<string, boolean>>({})
  return parts.filter(isKnowledgeEdit).map((part) => {
    const { path, line } = part.locations![0]
    const topic = allTopics().find((x) => x.path === path)
    return {
      key: `knowledge:${part.toolCallId}`,
      kind: "knowledge",
      icon: KIND_ICON.knowledge,
      name: topic?.name ?? part.title,
      detail: t({ message: "Updated", comment: "a topic Owlit changed from a chat" }),
      undone: !!undone[part.toolCallId],
      undo: canUndoRevision(part.toolCallId) ? () => setUndone((u) => ({ ...u, [part.toolCallId]: undoRevision(part.toolCallId) })) : undefined,
      view: topic ? () => navigate(`/knowledge/${topic.id}${line ? `#${topic.lines[line - 1]?.id ?? ""}` : ""}`) : undefined,
    }
  })
}
