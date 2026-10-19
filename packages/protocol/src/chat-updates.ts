import type { ChatAbout, ChatMessage, FileDiff, MessagePart, SessionUpdate } from "./chat.ts"

// How a message is built from an agent's stream; core (which saves it) and the app (which shows it) fold
// the same updates the same way.

// Whether two chats owlit started work on the same thing
export const sameAbout = (a: ChatAbout | undefined, b: ChatAbout | undefined) => !!a && !!b && a.kind === b.kind && a.id === b.id

// An agent whose turn fails often says why as the last text of its answer ("Failed to authenticate. API
// Error: 403 Request not allowed"). That isn't an answer: it is taken out of the parts and kept as the
// reply's errorDetail, for the line that says the reply broke.
const AGENT_ERROR = /^(?:[\w ]+\.\s+)?API Error\b|^Failed to authenticate\b|^(?:Error|Request failed):\s/
export function withoutAgentError(message: ChatMessage): ChatMessage {
  const last = message.parts.at(-1)
  if (message.status !== "error" || last?.type !== "text") return message
  const said = last.text.trim()
  if (!said || said.length > 600 || !AGENT_ERROR.test(said)) return message
  return { ...message, parts: message.parts.slice(0, -1), errorDetail: message.errorDetail ?? said }
}

// Fold one streamed update into the assistant message's parts. owlit's notice of a silent agent is one at
// most, kept last, and goes with anything the agent sends.
export function applyUpdate(parts: MessagePart[], u: SessionUpdate): MessagePart[] {
  if (u.type === "notice") return [...withoutNotice(parts), { type: "notice", notice: u.notice, since: u.since }]
  return fold(withoutNotice(parts), u)
}

export const withoutNotice = (parts: MessagePart[]) => (parts.some((p) => p.type === "notice") ? parts.filter((p) => p.type !== "notice") : parts)

// A tool call's diff as a later update brings it: the text it replaces, once known, stays when the update
// comes without it (an agent sends a Write's diff again with each update, never with what it replaces)
function diffOf(had: FileDiff | undefined, next: FileDiff | undefined): FileDiff | undefined {
  if (!next) return had
  return !next.oldText && had?.oldText && had.path === next.path ? { ...next, oldText: had.oldText } : next
}

function fold(parts: MessagePart[], u: Exclude<SessionUpdate, { type: "notice" }>): MessagePart[] {
  const last = parts[parts.length - 1]
  switch (u.type) {
    case "agent_message_chunk":
      // Two of the agent's messages in a row (Claude Code writes one each time an agent of its reports
      // back) stay two paragraphs rather than running into one another
      if (last?.type === "text" && (!u.messageId || !last.messageId || last.messageId === u.messageId)) return [...parts.slice(0, -1), { ...last, text: last.text + u.text }]
      return [...parts, { type: "text", text: u.text, ...(u.messageId ? { messageId: u.messageId } : {}) }]
    case "agent_thought_chunk":
      if (last?.type === "thought") return [...parts.slice(0, -1), { ...last, text: last.text + u.text }]
      return [...parts, { type: "thought", text: u.text }]
    case "tool_call":
      // A tool call announced again (an agent may, and owlit does before asking permission for it) is merged
      if (parts.some((p) => p.type === "tool_call" && p.toolCallId === u.toolCallId)) return fold(parts, { ...u, type: "tool_call_update" })
      return [...parts, { type: "tool_call", toolCallId: u.toolCallId, title: u.title, kind: u.kind, status: u.status, content: u.content, locations: u.locations, diff: u.diff, tool: u.tool, ...(u.agentId ? { agentId: u.agentId } : {}) }]
    case "tool_call_update":
      return parts.map((p) =>
        p.type === "tool_call" && p.toolCallId === u.toolCallId
          ? { ...p, status: u.status ?? p.status, title: u.title ?? p.title, content: u.content ?? p.content, locations: u.locations ?? p.locations, diff: diffOf(p.diff, u.diff), tool: u.tool ?? p.tool }
          : p,
      )
    case "plan": {
      const i = parts.findIndex((p) => p.type === "plan")
      const entry: MessagePart = { type: "plan", entries: u.entries }
      return i >= 0 ? parts.map((p, j) => (j === i ? entry : p)) : [...parts, entry]
    }
    case "agent_started":
      // Announced again (a session replaying its history) it keeps its place
      if (parts.some((p) => p.type === "agent" && p.agentId === u.agentId)) return fold(parts, { type: "agent_update", agentId: u.agentId, title: u.title })
      return [...parts, { type: "agent", agentId: u.agentId, title: u.title, status: "working" }]
    case "agent_update":
      return parts.map((p) =>
        p.type === "agent" && p.agentId === u.agentId
          ? { ...p, ...(u.title ? { title: u.title } : {}), ...(u.status ? { status: u.status } : {}), ...(u.report !== undefined ? { report: u.report } : {}) }
          : p,
      )
    case "permission_request":
      return [...parts, { type: "permission", requestId: u.requestId, toolCallId: u.toolCallId, title: u.title, kind: u.kind, options: u.options, ...(u.agentId ? { agentId: u.agentId } : {}) }]
    case "permission_resolved":
      return parts.map((p) => (p.type === "permission" && p.requestId === u.requestId ? { ...p, outcome: u.outcome } : p))
    case "question_request":
      return [...parts, { type: "question", requestId: u.requestId, toolCallId: u.toolCallId, questions: u.questions, ...(u.agentId ? { agentId: u.agentId } : {}) }]
    case "question_resolved":
      return parts.map((p) => (p.type === "question" && p.requestId === u.requestId ? { ...p, outcome: u.outcome, answers: u.answers } : p))
  }
}
