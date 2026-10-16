import type { MessagePart } from "@owlit/protocol"

// One kind of message part: Part<"permission">
export type Part<T extends MessagePart["type"]> = Extract<MessagePart, { type: T }>
export type ToolCall = Part<"tool_call">
export type QuestionPart = Part<"question">
