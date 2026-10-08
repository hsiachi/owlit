// Chat domain types. Message parts and session updates follow the shape of the
// Agent Client Protocol (ACP) so a real local-agent connector can feed them later.

export type SourceKind = "paper" | "doc" | "knowledge"

// Something the user can @-mention from Library (papers), Docs or Knowledge
export interface Mentionable {
  id: string
  kind: SourceKind
  title: string
  // paper: authors · year; doc: relative path; knowledge: item kind label
  subtitle?: string
  uri: string
}

export interface AttachmentFile {
  id: string
  name: string
  size: number
  mimeType: string
  // Object URL for image previews; not persisted
  previewUrl?: string
}

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other"

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

export interface ToolLocation {
  path: string
  line?: number
}

// ACP "diff" tool call content: a file's whole text before and after an edit
export interface FileDiff {
  // Workspace-relative path, e.g. "writing/Related work.md"
  path: string
  oldText: string
  newText: string
}

// A passage the user selected and sent along with a message
export interface QuotedSelection {
  text: string
  // The doc or paper it came from
  source: Mentionable
}

export interface PlanEntry {
  content: string
  priority: "high" | "medium" | "low"
  status: "pending" | "in_progress" | "completed"
}

export type PermissionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

export interface PermissionOption {
  optionId: string
  name: string
  kind: PermissionKind
}

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | {
      type: "tool_call"
      toolCallId: string
      title: string
      kind: ToolKind
      status: ToolStatus
      content?: string
      locations?: ToolLocation[]
      diff?: FileDiff
    }
  | { type: "plan"; entries: PlanEntry[] }
  | {
      type: "permission"
      requestId: string
      toolCallId: string
      title: string
      kind: ToolKind
      options: PermissionOption[]
      // Set once the user answered
      outcome?: PermissionKind | "cancelled"
    }

export type MessageStatus = "streaming" | "done" | "cancelled" | "error"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  attachments?: AttachmentFile[]
  mentions?: Mentionable[]
  context?: Mentionable[]
  selection?: QuotedSelection
  createdAt: number
  status?: MessageStatus
  // Connector and model that produced an assistant message
  connectorId?: string
  modelId?: string
  error?: string
}

export interface Chat {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinned: boolean
  connectorId?: string
  modelId?: string
  modeId?: string
  effortId?: string
  messages: ChatMessage[]
}

// ---- Local agent connectors ----

export type ConnectorStatus =
  | "unknown"
  | "checking"
  | "not_installed"
  | "available"
  | "connected"
  | "error"

export interface AgentModel {
  id: string
  name: string
  description?: string
}

export interface AgentMode {
  id: string
  name: string
  description?: string
}

// Reasoning effort, when the agent exposes it (Claude Code, Codex)
export interface AgentEffort {
  id: string
  name: string
  description?: string
}

export interface Connector {
  id: string
  name: string
  description: string
  // Command the desktop shell will spawn (ACP over stdio)
  command: string
  installHint?: string
  builtIn: boolean
  status: ConnectorStatus
  version?: string
  authenticated?: boolean
  error?: string
  models: AgentModel[]
  modes: AgentMode[]
  efforts?: AgentEffort[]
  defaultModelId?: string
  defaultModeId?: string
  defaultEffortId?: string
}

// ---- Session updates streamed from an agent (ACP SessionUpdate subset) ----

export type SessionUpdate =
  | { type: "agent_message_chunk"; text: string }
  | { type: "agent_thought_chunk"; text: string }
  | {
      type: "tool_call"
      toolCallId: string
      title: string
      kind: ToolKind
      status: ToolStatus
      content?: string
      locations?: ToolLocation[]
      diff?: FileDiff
    }
  | {
      type: "tool_call_update"
      toolCallId: string
      status?: ToolStatus
      title?: string
      content?: string
      locations?: ToolLocation[]
      diff?: FileDiff
    }
  | { type: "plan"; entries: PlanEntry[] }
  | {
      type: "permission_request"
      requestId: string
      toolCallId: string
      title: string
      kind: ToolKind
      options: PermissionOption[]
    }
  | { type: "permission_resolved"; requestId: string; outcome: PermissionKind | "cancelled" }

export type StopReason = "end_turn" | "cancelled" | "refusal" | "error"

export interface PromptInput {
  text: string
  mentions: Mentionable[]
  attachments: AttachmentFile[]
  // What is on screen when asking from the agent window (the open doc or paper)
  context?: Mentionable[]
  selection?: QuotedSelection
}
