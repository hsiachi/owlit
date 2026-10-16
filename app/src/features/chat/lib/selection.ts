import { t } from "@lingui/core/macro"
import { type Chat, type Connector, DEFAULT_ROLE, type Role, ROLES } from "@owlit/protocol"

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

// A role's name and what it does, in the interface's language. ROLES keeps them in English for core,
// which tells the agent its role in those words.
export function roleWords(role: Role): { name: string; description: string } {
  switch (role) {
    case "reviewer":
      return { name: t({ message: "Reviewer", comment: "Owlit's role" }), description: t`Reads, answers and leaves comments. Never changes your files or library.` }
    case "assistant":
      return { name: t({ message: "Assistant", comment: "Owlit's role" }), description: t`Finds and adds papers, keeps its own notes. Your writing changes only when you apply it.` }
    case "coauthor":
      return { name: t({ message: "Co-author", comment: "Owlit's role" }), description: t`Also edits your docs and runs commands in this workspace. Every change can be undone.` }
  }
}

// The name of the model a reply came from, while its agent still lists it
export const modelNameOf = (connectors: Connector[], connectorId?: string, modelId?: string) =>
  connectors.find((c) => c.id === connectorId)?.models.find((m) => m.id === modelId)?.name
