// What the engine tells owlit while it works: pi-agent-core's events as ACP session updates, in the
// shapes Claude Code's adapter sends, so owlit's chat shows them without knowing which agent runs.

import type { SessionUpdate, ToolKind } from "@agentclientprotocol/sdk"
import type { AgentEvent } from "@earendil-works/pi-agent-core"

export interface ToolInfo {
  // On screen: mcp__<server>__<tool>, as Claude Code names MCP tools, which owlit already puts in words;
  // a file tool names its file ("Edit notes.md")
  title: string | ((args: Record<string, unknown> | undefined) => string)
  kind: ToolKind
  // The files it touches, so owlit can tell which chat changed them
  locations?: (args: Record<string, unknown> | undefined) => string[]
}

export function updatesFor(event: AgentEvent, tools: (name: string) => ToolInfo | undefined): SessionUpdate[] {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent
      if (e.type === "text_delta") return [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: e.delta } }]
      if (e.type === "thinking_delta") return [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: e.delta } }]
      return []
    }
    case "tool_execution_start": {
      const tool = tools(event.toolName)
      const title = typeof tool?.title === "function" ? tool.title(event.args) : (tool?.title ?? event.toolName)
      const locations = tool?.locations?.(event.args).map((path) => ({ path }))
      return [{ sessionUpdate: "tool_call", toolCallId: event.toolCallId, title, kind: tool?.kind ?? "other", status: "in_progress", rawInput: event.args, ...(locations?.length ? { locations } : {}) }]
    }
    case "tool_execution_end": {
      const text = resultText(event.result)
      return [
        {
          sessionUpdate: "tool_call_update",
          toolCallId: event.toolCallId,
          status: event.isError ? "failed" : "completed",
          ...(text ? { content: [{ type: "content" as const, content: { type: "text" as const, text } }] } : {}),
        },
      ]
    }
    default:
      return []
  }
}

// A tool result's text, for the step's detail; images and the rest are left out
function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content
  if (!Array.isArray(content)) return ""
  return content
    .filter((c) => c.type === "text" && c.text)
    .map((c) => c.text)
    .join("\n")
}

// Read-only tools by name, so a Reviewer's steps read as reading (owlit refuses edits by kind)
export function kindOf(tool: string): ToolKind {
  if (/_(list|get|read|highlights)$|^owlit_help$/.test(tool)) return "read"
  if (tool.endsWith("_search") || tool === "library_related" || tool === "library_journal") return "search"
  return "other"
}
