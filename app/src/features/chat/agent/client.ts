import type { Connector, PromptInput, SessionUpdate, StopReason } from "../types"

export interface PromptRequest {
  chatId: string
  connectorId: string
  modelId?: string
  modeId?: string
  effortId?: string
  input: PromptInput
}

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
