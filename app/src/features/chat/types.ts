// Chat wire types live in @owlit/protocol; this file keeps the old import path working.

import type { MessagePart } from "@owlit/protocol"

// One kind of message part: Part<"permission">
export type Part<T extends MessagePart["type"]> = Extract<MessagePart, { type: T }>
export type ToolCall = Part<"tool_call">
export type QuestionPart = Part<"question">

export type {
  SourceKind,
  Mentionable,
  AttachmentFile,
  ToolKind,
  ToolStatus,
  ToolLocation,
  FileDiff,
  QuotedSelection,
  PlanEntry,
  PermissionKind,
  PermissionOption,
  MessagePart,
  MessageStatus,
  ChatMessage,
  Chat,
  ConnectorStatus,
  AgentModel,
  AgentMode,
  Role,
  AgentEffort,
  Connector,
  SignIn,
  SessionUpdate,
  StopReason,
  PromptInput,
} from "@owlit/protocol"
