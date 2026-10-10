import type { ConsentAction, Role, ToolKind } from "@owlit/protocol"

// What a role means on each agent. owlit relies on one thing: an agent asks, with the diff, before it
// changes the user's files. Each agent is held to that with its own controls, since none of them sends
// its edits through ACP's fs/write_text_file (tried 2026-10-10 with claude-agent-acp 0.88 and
// codex-acp 2.2.1):
// - Claude Code runs in its auto mode. Its own permission rules make its file-editing tools ask (or
//   refuse) even there, and its sandbox stops shell commands writing the workspace, so a `sed` or an
//   `echo >>` fails and it falls back to the editing tool, which asks. Its auto classifier still judges
//   everything else (commands, the network).
// - Codex's read-only mode already asks, with the patch, before any edit, and its sandbox makes a shell
//   command that writes ask first; its auto-review mode lets it work and has its own reviewer judge what
//   is risky.
// - Any other agent keeps the mode it starts in; owlit still refuses what a Reviewer may not do.
export interface Guard {
  // The agent's own modes to set, in order of preference; the first it offers wins
  modes: string[]
  // Sent with session/new and session/load; changing it rebuilds the agent's session
  meta?: Record<string, unknown>
}

const CLAUDE_EDIT_TOOLS = ["Edit", "Write"]

export function guardFor(connectorId: string, role: Role, roots: string[]): Guard {
  if (connectorId === "claude-code") {
    // Without auto mode (a plan or model that lacks it) the default mode asks for everything, which only
    // makes a Co-author ask more
    const modes = ["auto", "default"]
    if (role === "coauthor") return { modes, meta: { claudeCode: { options: {} } } }
    const permissions = role === "reviewer" ? { deny: CLAUDE_EDIT_TOOLS } : { ask: CLAUDE_EDIT_TOOLS }
    const sandbox = {
      enabled: true,
      // Without a sandbox (Windows), commands could write where the role says they can't: the turn fails
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyWrite: roots },
    }
    return { modes, meta: { claudeCode: { options: { settings: { permissions }, sandbox } } } }
  }
  if (connectorId === "codex") return { modes: role === "coauthor" ? ["agent", "workspace-write"] : ["read-only"] }
  return { modes: [] }
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
