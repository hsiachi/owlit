import type * as acp from "@agentclientprotocol/sdk"
import type { Role, ToolKind } from "@owlit/protocol"
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

// Told to the agent before a prompt whenever the chat's role is new to its session. What owlit's own tools
// let each role do is decided by the policy (policy.ts) whatever this says; this tells the agent ahead.
export function roleNote(role: Role) {
  switch (role) {
    case "reviewer":
      return "[owlit] In this chat Owlit works as Reviewer: read, answer, and leave comments on a doc's passages with docs_add_comment. Change nothing of the user's: not their files, their papers, their comments or their threads; when a change would help, describe it in your answer. Your own comments, threads, memory, highlights and the papers you add are yours to write and take back. If they want you to make a change, say they can choose Assistant or Co-author in the composer."
    case "assistant":
      return "[owlit] In this chat Owlit works as Assistant: you may add papers the user asked for, ask for digests, star, tag and mark their papers with library_update, reply to and resolve comments, and rename threads; owlit records each so the user can undo it. The user sees each edit to their files and applies it themselves, so edit files with your file-editing tool, never with shell commands; delete or move docs with docs_delete and docs_move."
    case "coauthor":
      return "[owlit] In this chat Owlit works as Co-author: you may edit the user's docs and run commands inside the workspace without asking; owlit keeps every change so the user can undo it. Stay inside the workspace, and change owlit's own state (.owlit/, library/) only through owlit's tools."
  }
}
