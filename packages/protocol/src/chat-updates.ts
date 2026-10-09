import type { MessagePart, SessionUpdate } from "./chat.ts"

// How a message is built from an agent's stream; core (which saves it) and the app (which shows it) fold
// the same updates the same way.

// Fold one streamed update into the assistant message's parts
export function applyUpdate(parts: MessagePart[], u: SessionUpdate): MessagePart[] {
  const last = parts[parts.length - 1]
  switch (u.type) {
    case "agent_message_chunk":
      if (last?.type === "text") return [...parts.slice(0, -1), { ...last, text: last.text + u.text }]
      return [...parts, { type: "text", text: u.text }]
    case "agent_thought_chunk":
      if (last?.type === "thought") return [...parts.slice(0, -1), { ...last, text: last.text + u.text }]
      return [...parts, { type: "thought", text: u.text }]
    case "tool_call":
      // A tool call announced again (an agent may, and owlit does before asking permission for it) is merged
      if (parts.some((p) => p.type === "tool_call" && p.toolCallId === u.toolCallId)) return applyUpdate(parts, { ...u, type: "tool_call_update" })
      return [...parts, { type: "tool_call", toolCallId: u.toolCallId, title: u.title, kind: u.kind, status: u.status, content: u.content, locations: u.locations, diff: u.diff }]
    case "tool_call_update":
      return parts.map((p) =>
        p.type === "tool_call" && p.toolCallId === u.toolCallId
          ? { ...p, status: u.status ?? p.status, title: u.title ?? p.title, content: u.content ?? p.content, locations: u.locations ?? p.locations, diff: u.diff ?? p.diff }
          : p,
      )
    case "plan": {
      const i = parts.findIndex((p) => p.type === "plan")
      const entry: MessagePart = { type: "plan", entries: u.entries }
      return i >= 0 ? parts.map((p, j) => (j === i ? entry : p)) : [...parts, entry]
    }
    case "permission_request":
      return [...parts, { type: "permission", requestId: u.requestId, toolCallId: u.toolCallId, title: u.title, kind: u.kind, options: u.options }]
    case "permission_resolved":
      return parts.map((p) => (p.type === "permission" && p.requestId === u.requestId ? { ...p, outcome: u.outcome } : p))
  }
}
