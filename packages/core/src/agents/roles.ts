import type * as acp from "@agentclientprotocol/sdk"
import { ROLES, roleSentences, type Role, type ToolKind } from "@owlit/protocol"
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
// change something is refused; an Assistant's request to edit, delete or move a file is allowed at once,
// since the change lands as a proposal (ROLE_TABLE's propose: recorded as Owlit's, marked until seen,
// Undo per passage); everything else is the user's to answer
export function answerFor(role: Role, kind: ToolKind): "reject" | "allow" | "ask" {
  const change = kind === "edit" || kind === "delete" || kind === "move"
  if (role === "reviewer" && (change || kind === "execute")) return "reject"
  if (role === "assistant" && change) return "allow"
  return "ask"
}

// Told to the agent before a prompt whenever the chat's role is new to its session: what the role may do,
// in the sentences the person read in the composer (protocol's roleSentences, read off the policy's
// table), then how to work within it. What owlit's own tools let each role do is decided by the policy
// (policy.ts) whatever this says; this tells the agent ahead.
export function roleNote(role: Role) {
  const name = ROLES.find((r) => r.id === role)!.name
  const may = roleSentences(role).join(". ")
  return `[owlit] In this chat Owlit works as ${name}: ${may}. ${HOW[role]}`
}

const HOW: Record<Role, string> = {
  reviewer:
    "Read, answer, and leave comments on a doc's passages with docs_add_comment. When a change to the user's files, papers, comments or threads would help, describe it in your answer; your own comments, threads, memory, highlights and the papers you add are yours to write and take back. If they want you to make a change, say they can choose Assistant or Co-author in the composer.",
  assistant:
    "You may add papers the user asked for, ask for digests, star, tag and mark their papers with library_update, reply to and resolve comments, and rename threads; owlit records each so the user can undo it. Your edits to the user's docs land at once as marked proposals: edit with your file-editing tool, one passage at a time, so each part is its own decision, and never with shell commands. Delete or move docs with docs_delete and docs_move; they land the same way, with Undo.",
  coauthor: "You may edit the user's docs and run commands inside the workspace without asking; owlit keeps every change to their docs so the user can undo it, and can't take back what a command changes elsewhere. Stay inside the workspace, and change owlit's own state (.owlit/, library/) only through owlit's tools.",
}
