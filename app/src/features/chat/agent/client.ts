import type { ChatMessage, Connector, PromptInput, QuestionAnswer, Role, SessionUpdate, StopReason } from "@owlit/protocol"

export interface PromptRequest {
  chatId: string
  connectorId: string
  modelId?: string
  role?: Role
  effortId?: string
  input: PromptInput
  // The messages the turn adds: the person's, and the reply's id
  userMessage: ChatMessage
  assistantMessageId: string
}

// A turn running now, with its reply as it stands
export interface RunningTurn {
  chatId: string
  messageId: string
  message: ChatMessage
}

// What the UI needs from a local agent (RpcAgentClient: ACP through core). The client runs the turns and
// is their only record: the window learns of every turn's updates and end through onUpdate and onEnded,
// whoever started it, and of the turns already running through running().
export interface AgentClient {
  // Probe whether the agent's command is installed and signed in
  check(connector: Connector): Promise<Connector>
  // Starts a turn; resolves with how it ended, after onEnded has said so. Rejects with the reason a turn
  // broke, or couldn't start (then nothing was saved and onEnded says nothing).
  prompt(req: PromptRequest): Promise<StopReason>
  // Stops the chat's running turn, also while its agent is still starting
  cancel(chatId: string): void
  running(): Promise<RunningTurn[]>
  onUpdate(listener: (chatId: string, messageId: string, update: SessionUpdate) => void): () => void
  // A turn ended, with its reply as saved
  onEnded(listener: (chatId: string, messageId: string, message: ChatMessage) => void): () => void
  respondPermission(chatId: string, requestId: string, optionId: string): void
  // Answers a question by question id; null skips it
  answerQuestion(chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null): void
}
