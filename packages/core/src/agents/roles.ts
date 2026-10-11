import type * as acp from "@agentclientprotocol/sdk"
import type { ConsentAction, Role, ToolKind } from "@owlit/protocol"
import type { Guard } from "./profiles.ts"

// Whether the agent takes owlit's rules, its role and the user's name in its own system prompt (it says so
// when it starts, as the Owlit engine does); owlit then leaves them out of the first prompt
export const takesRules = (init: acp.InitializeResponse) => (init._meta as { owlit?: { rulesInSystemPrompt?: unknown } } | null | undefined)?.owlit?.rulesInSystemPrompt === true

// The user's name, for such an agent, with the session's options; a new name makes a new session
export function withUserName(guard: Guard, userName: string | undefined): Guard {
  if (!userName) return guard
  const owlit = (guard.meta?.owlit as Record<string, unknown> | undefined) ?? {}
  return { ...guard, meta: { ...guard.meta, owlit: { ...owlit, userName } } }
}

// How owlit answers an agent's permission request before the user sees it: a Reviewer's request to
// change something is refused; everything else is the user's to answer
export function answerFor(role: Role, kind: ToolKind): "reject" | "ask" {
  if (role === "reviewer" && (kind === "edit" || kind === "delete" || kind === "move" || kind === "execute")) return "reject"
  return "ask"
}

// Whether owlit's own tools may go ahead (agents.consent). Owlit's own space (reading notes, Knowledge,
// margin notes) needs no consent; these do.
export function consentFor(role: Role, action: ConsentAction): "allow" | "ask" | { refuse: string } {
  if (role === "reviewer") {
    return { refuse: action === "add_paper" ? "Owlit works as Reviewer in this chat and doesn't change the library. Name the papers in your answer instead." : "Owlit works as Reviewer in this chat and doesn't change the user's files. Describe the change in your answer instead." }
  }
  if (role === "assistant") return action === "add_paper" ? "allow" : "ask"
  return "allow"
}

// Told to the agent before a prompt whenever the chat's role is new to its session
export function roleNote(role: Role) {
  switch (role) {
    case "reviewer":
      return "[owlit] In this chat Owlit works as Reviewer: read, answer, and leave comments in a doc's margin with docs_add_note. Don't change the user's files or library; when a change would help, describe it in your answer. If they want you to make it, say they can choose Assistant or Co-author in the composer."
    case "assistant":
      return "[owlit] In this chat Owlit works as Assistant: you may add papers the user asked for and write reading notes. The user sees each edit to their files and applies it themselves, so edit files with your file-editing tool, never with shell commands; delete or move docs with docs_delete and docs_move."
    case "coauthor":
      return "[owlit] In this chat Owlit works as Co-author: you may edit the user's docs and run commands inside the workspace without asking; owlit keeps every change so the user can undo it. Stay inside the workspace."
  }
}
