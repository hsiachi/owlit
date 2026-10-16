import type * as acp from "@agentclientprotocol/sdk"
import { HUNK_GAP, type AgentStatus, type SessionUpdate, type ToolKind } from "@owlit/protocol"
import path from "node:path"
import type { AgentNotice } from "./process.ts"
import { handbackOf } from "./profiles.ts"
import { toolInfoOf } from "./questions.ts"

// What an agent sends over ACP, as owlit's chat updates: for a chat turn (turns.ts) and a background run
// (background.ts) alike

const KINDS = new Set<ToolKind>(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"])
export const toKind = (kind?: string | null): ToolKind => (kind && KINDS.has(kind as ToolKind) ? (kind as ToolKind) : "other")

// Paths the agent reports, as the app shows them: relative to the workspace when inside it
const relative = (file: string, root: string) => {
  const rel = path.relative(root, file)
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file
}

export function toolContent(call: { content?: acp.ToolCallContent[] | null; locations?: acp.ToolCallLocation[] | null }, root: string) {
  const out: { content?: string; locations?: { path: string; line?: number }[]; diff?: { path: string; oldText: string; newText: string } } = {}
  const text = (call.content ?? [])
    .map((c) => (c.type === "content" && c.content.type === "text" ? c.content.text : ""))
    .filter(Boolean)
    .join("\n")
  if (text) out.content = text
  // Claude Code reports a finished edit as one diff per changed part of the file; they are kept together,
  // a gap line between parts, so the step shows and counts the whole edit rather than its first part
  const diffs = (call.content ?? []).flatMap((c) => (c.type === "diff" ? [c] : []))
  const parts = diffs.filter((d) => d.path === diffs[0]?.path)
  if (parts.length)
    out.diff = {
      path: relative(parts[0].path, root),
      oldText: parts.map((d) => d.oldText ?? "").join(`\n${HUNK_GAP}\n`),
      newText: parts.map((d) => d.newText).join(`\n${HUNK_GAP}\n`),
    }
  if (call.locations?.length) out.locations = call.locations.map((l) => ({ path: relative(l.path, root), ...(l.line != null ? { line: l.line } : {}) }))
  return out
}

export function toUpdate(u: acp.SessionUpdate, root: string): SessionUpdate | null {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return u.content.type === "text" ? { type: "agent_message_chunk", text: u.content.text, ...(u.messageId ? { messageId: u.messageId } : {}) } : null
    case "agent_thought_chunk":
      return u.content.type === "text" ? { type: "agent_thought_chunk", text: u.content.text } : null
    case "tool_call": {
      const tool = toolInfoOf(u)
      return { type: "tool_call", toolCallId: u.toolCallId, title: u.title, kind: toKind(u.kind), status: u.status ?? "pending", ...toolContent(u, root), ...(tool ? { tool } : {}) }
    }
    case "tool_call_update": {
      // Claude Code sends the input again once it is complete; an update without it keeps what came first
      const tool = u.rawInput !== undefined ? toolInfoOf(u) : undefined
      return { type: "tool_call_update", toolCallId: u.toolCallId, ...(u.status ? { status: u.status } : {}), ...(u.title ? { title: u.title } : {}), ...toolContent(u, root), ...(tool ? { tool } : {}) }
    }
    case "plan":
      return { type: "plan", entries: u.entries.map((e) => ({ content: e.content, priority: e.priority, status: e.status })) }
    default:
      return null
  }
}

// The state agentWork keeps for each reply: what each of the agent's own agents said as text, and the
// ones that handed a report back
export interface HelperReports {
  agentText: Map<string, string>
  handedBack: Set<string>
}

// What one of the agent's own agents sent: its steps, marked as its own, and its report. Its report is
// the call it hands back with, or else what it said as text (an agent may tell its findings that way).
// Never the reply's own words: a chat turn and a background run both keep them apart.
export function agentWork(reports: HelperReports, agentId: string, u: acp.SessionUpdate, root: string): SessionUpdate[] {
  const out: SessionUpdate[] = []
  if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
    const report = handbackOf(u)
    if (report) {
      reports.handedBack.add(agentId)
      out.push({ type: "agent_update", agentId, report })
    }
  }
  if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
    const text = (reports.agentText.get(agentId) ?? "") + u.content.text
    reports.agentText.set(agentId, text)
    if (!reports.handedBack.has(agentId)) out.push({ type: "agent_update", agentId, report: text })
    return out
  }
  const update = toUpdate(u, root)
  if (update?.type === "tool_call") out.push({ ...update, agentId })
  else if (update?.type === "tool_call_update") out.push(update)
  return out
}

// One of the agent's own agents started or changed state
export function agentNotice(notice: AgentNotice): SessionUpdate[] {
  if (notice.kind === "started") return [{ type: "agent_started", agentId: notice.agentId, title: notice.title }]
  const status = agentStatus(notice.state)
  return status ? [{ type: "agent_update", agentId: notice.agentId, status }] : []
}

// An agent's state, as owlit shows it: the adapters' words ("completed", "cancelled") and the draft's
// ("idle" once it has nothing left to do; "running" and "requires_action" while it is at it)
function agentStatus(state: string): AgentStatus | undefined {
  if (state === "completed" || state === "idle" || state === "done") return "done"
  if (state === "cancelled" || state === "interrupted") return "stopped"
  if (state === "failed" || state === "error") return "failed"
  if (state === "running" || state === "requires_action") return "working"
  return undefined
}
