import { useState } from "react"
import { useNavigate } from "react-router-dom"
import type { MessagePart } from "@/features/chat/types"
import { canUndoRevision, undoRevision } from "../agent"
import { allTopics } from "../store"

type ToolCall = Extract<MessagePart, { type: "tool_call" }>

const isKnowledgeEdit = (p: MessagePart): p is ToolCall =>
  p.type === "tool_call" && p.kind === "edit" && p.status === "completed" && !!p.locations?.[0]?.path.startsWith("knowledge/")

// Under an answer that changed Knowledge: "Updated · topic · 3", with Undo and View. A correction made in
// chat lands the same way as one made on the topic page: one line changes.
export function KnowledgeUpdates({ parts }: { parts: MessagePart[] }) {
  const edits = parts.filter(isKnowledgeEdit)
  if (!edits.length) return null
  return (
    <div className="flex flex-col gap-0.5">
      {edits.map((p) => (
        <UpdateRow key={p.toolCallId} part={p} />
      ))}
    </div>
  )
}

function UpdateRow({ part }: { part: ToolCall }) {
  const navigate = useNavigate()
  const [undone, setUndone] = useState(false)
  const { path, line } = part.locations![0]
  const topic = allTopics().find((t) => t.path === path)
  return (
    <p className="flex items-center gap-1 text-[13px] text-muted-foreground">
      <span>{undone ? "Undone" : part.title}</span>
      {!undone && canUndoRevision(part.toolCallId) && (
        <button
          type="button"
          onClick={() => setUndone(undoRevision(part.toolCallId))}
          className="rounded-md px-1 outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted"
        >
          Undo
        </button>
      )}
      {!undone && topic && (
        <button
          type="button"
          onClick={() => navigate(`/knowledge/${topic.id}${line ? `#${topic.lines[line - 1]?.id ?? ""}` : ""}`)}
          className="rounded-md px-1 outline-none hover:bg-muted hover:text-foreground focus-key:bg-muted"
        >
          View
        </button>
      )}
    </p>
  )
}
