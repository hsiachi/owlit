import type { Connector, PromptInput, SessionUpdate, StopReason } from "../types"

export interface PromptRequest {
  chatId: string
  connectorId: string
  modelId?: string
  modeId?: string
  effortId?: string
  input: PromptInput
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

// What the UI needs from a local agent. The mock implements it now; the desktop
// shell will implement it over ACP (JSON-RPC on stdio) later.
export interface AgentClient {
  listConnectors(): Promise<Connector[]>
  // Probe whether the agent's command is installed and signed in
  check(connector: Connector): Promise<Connector>
  prompt(
    req: PromptRequest,
    onUpdate: (update: SessionUpdate) => void,
    signal: AbortSignal,
  ): Promise<StopReason>
  respondPermission(chatId: string, requestId: string, optionId: string): void
}
