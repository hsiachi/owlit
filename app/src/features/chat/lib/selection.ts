import { t } from "@lingui/core/macro"
import { type Chat, type Connector, DEFAULT_ROLE, type Role, ROLE_TABLE, ROLES, RUNS_COMMANDS } from "@owlit/protocol"

// The agent and model new chats start with, kept across restarts. Owlit's role is not here: it belongs
// to its chat (Chat.role), and a new chat starts as Assistant whatever the last one was, since a role
// picked once for a review is not what the next question wants.
export interface Selection {
  connectorId: string
  modelId?: string
  effortId?: string
}

// A chat's own choice once it has one, else the one new chats start with
export const selectionOf = (chat: Pick<Chat, "connectorId" | "modelId" | "effortId"> | undefined, fallback: Selection): Selection =>
  chat?.connectorId ? { connectorId: chat.connectorId, modelId: chat.modelId, effortId: chat.effortId } : fallback

// The role a chat works in: its own, or Assistant for a chat saved before roles existed
export const roleOf = (chat: Pick<Chat, "role"> | undefined, fallback: Role = DEFAULT_ROLE) => ROLES.find((r) => r.id === chat?.role) ?? ROLES.find((r) => r.id === fallback)!

// The agent, model and effort a selection comes to, as the pickers show them: an agent that is gone is
// the first one, and a model or effort the agent no longer offers (such as Claude Code's "default",
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
  return { connector, model, effort }
}

// A role's name, in the interface's language
export function roleName(role: Role) {
  switch (role) {
    case "reviewer":
      return t({ message: "Reviewer", comment: "Owlit's role" })
    case "assistant":
      return t({ message: "Assistant", comment: "Owlit's role" })
    case "coauthor":
      return t({ message: "Co-author", comment: "Owlit's role" })
  }
}

// What a role may do, one sentence a class, read off the policy's table (protocol's ROLE_TABLE), so the
// composer's menu, onboarding and Settings say what core decides; the agent hears the same sentences in
// English (protocol's roleSentences). Each is a line, so a change of one word changes it everywhere.
export function roleLines(role: Role): string[] {
  const out = [t`Reads your workspace`, t`Keeps its own comments, threads, memory and highlights`]
  if (ROLE_TABLE.meta[role] !== "refuse") out.push(t`Stars, tags and sorts papers, with Undo`)
  const words = ROLE_TABLE.words[role]
  out.push(words === "refuse" ? t`Never changes your writing` : words === "propose" ? t`Edits your docs as marked proposals; undo any part` : t`Edits your docs; undo any part`)
  if (ROLE_TABLE.structure[role] !== "refuse") out.push(t`Moves or deletes into the Trash, with Undo`)
  if (RUNS_COMMANDS[role]) out.push(t`Runs commands in this workspace; what they change outside your docs has no Undo`)
  else if (words !== "refuse") out.push(t`Never changes anything with commands`)
  return out
}

// A role's name and what it does, as one sentence (the chip's tooltip)
export function roleWords(role: Role): { name: string; description: string } {
  return { name: roleName(role), description: `${roleLines(role).join(". ")}.` }
}

// The name of the model a reply came from, while its agent still lists it
export const modelNameOf = (connectors: Connector[], connectorId?: string, modelId?: string) =>
  connectors.find((c) => c.id === connectorId)?.models.find((m) => m.id === modelId)?.name
