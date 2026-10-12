import { DEFAULT_ROLE, ROLES } from "@owlit/protocol"
import type { Chat, Connector, Role } from "../types"

export interface Selection {
  connectorId: string
  modelId?: string
  // Owlit's role, the same whichever agent runs; it stays when the agent changes
  role: Role
  effortId?: string
}

// A chat's own choice once it has one, else the one new chats start with
export const selectionOf = (chat: Pick<Chat, "connectorId" | "modelId" | "role" | "effortId"> | undefined, fallback: Selection): Selection =>
  chat?.connectorId ? { connectorId: chat.connectorId, modelId: chat.modelId, role: chat.role ?? fallback.role, effortId: chat.effortId } : fallback

// The agent, model, effort and role a selection comes to, as the pickers show them: an agent that is gone
// is the first one, and a model or effort the agent no longer offers (such as Claude Code's "default",
// which owlit doesn't show) is the agent's own default
export function resolveSelection(connectors: Connector[], selection: Selection) {
  const connector = connectors.find((c) => c.id === selection.connectorId) ?? connectors[0]
  const model =
    connector?.models.find((m) => m.id === selection.modelId) ??
    connector?.models.find((m) => m.id === connector.defaultModelId) ??
    connector?.models[0]
  const effort =
    connector?.efforts?.find((e) => e.id === selection.effortId) ??
    connector?.efforts?.find((e) => e.id === connector.defaultEffortId) ??
    connector?.efforts?.[0]
  const role = ROLES.find((r) => r.id === selection.role) ?? ROLES.find((r) => r.id === DEFAULT_ROLE)!
  return { connector, model, effort, role }
}

// The name of the model a reply came from, while its agent still lists it
export const modelNameOf = (connectors: Connector[], connectorId?: string, modelId?: string) =>
  connectors.find((c) => c.id === connectorId)?.models.find((m) => m.id === modelId)?.name
