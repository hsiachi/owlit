import type { QuestionAnswer, Role } from "@owlit/protocol"
import type { ChatMessage, Connector, PromptInput, SessionUpdate, StopReason } from "../types"

export interface PromptRequest {
  chatId: string
  connectorId: string
  modelId?: string
  role?: Role
  effortId?: string
  input: PromptInput
  // The messages the turn adds, for a client that saves them itself
  userMessage?: ChatMessage
  assistantMessageId?: string
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
// in a plain browser.
export interface AgentClient {
  // Saves the turn's messages itself (core does, in the desktop app), so the store doesn't
  readonly persistsMessages?: boolean
  // Probe whether the agent's command is installed and signed in
  check(connector: Connector): Promise<Connector>
  prompt(
    req: PromptRequest,
    onUpdate: (update: SessionUpdate) => void,
    signal: AbortSignal,
  ): Promise<StopReason>
  respondPermission(chatId: string, requestId: string, optionId: string): void
  // Answers a question by question id; null skips it
  answerQuestion(chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null): void
}
