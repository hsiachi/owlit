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

// The workspace files an agent may read and write. In ACP the client (owlit) serves these as
// fs/read_text_file and fs/write_text_file, so an edit always lands through the app, which can show it
// in an open editor. Paths are workspace-relative.
export interface WorkspaceFs {
  readTextFile(path: string): Promise<string | null>
  writeTextFile(path: string, content: string): Promise<void>
}

let workspaceFs: WorkspaceFs | null = null
export const setWorkspaceFs = (fs: WorkspaceFs) => {
  workspaceFs = fs
}
export const getWorkspaceFs = () => workspaceFs

// Notes an agent leaves on a passage of a doc, kept beside the file. ACP has no such method; owlit will
// offer it to agents as a tool of its own. Returns false when the passage isn't in the doc.
export interface WorkspaceNotes {
  addNote(note: { path: string; quote: string; text: string; by: string; chatId?: string }): Promise<boolean>
}

let workspaceNotes: WorkspaceNotes | null = null
export const setWorkspaceNotes = (notes: WorkspaceNotes) => {
  workspaceNotes = notes
}
export const getWorkspaceNotes = () => workspaceNotes

// What the UI needs from a local agent: RpcAgentClient in the desktop app (ACP through core), the mock
// in a plain browser. The client runs the turns and is their only record: the window learns of every
// turn's updates and end through onUpdate and onEnded, whoever started it, and of the turns already
// running through running().
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
