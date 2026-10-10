// What an owlit session takes from the agent's own setup: nothing but its sign-in. A user's agent carries
// whatever they set up for their other work (skills, plugins, hooks, MCP servers, subagents, their
// CLAUDE.md, and on Claude Code the connectors of their claude.ai account), and all of it reached Owlit:
// a stuck claude.ai connector tool held a turn for five minutes (2026-10-10), and one probe session was
// offered over a hundred skills, a screen recorder's MCP server and Gmail. owlit's own MCP server and
// rules are what the agent should work with.
//
// Claude Code (claude-agent-acp 0.88) passes `_meta.claudeCode.options` to the Agent SDK over its own
// defaults, so:
// - settingSources [] reads none of ~/.claude/settings.json, .claude/ or CLAUDE.md, and with them the
//   user's hooks, plugins, skills and subagents; skills [] and plugins [] say so outright
// - strictMcpConfig keeps the MCP servers to the ones owlit passes, claude.ai connectors included;
//   disableClaudeAiConnectors says so again
// - tools lists the built-in tools owlit wants. The rest publish or act outside the workspace (Artifact,
//   scheduled and remote agents, push notifications, worktrees) or mean nothing here, and a Claude Code
//   update can't add one behind owlit's back. ToolSearch stays because MCP tools may be deferred behind it.
// Auto mode doesn't depend on any of it (checked: the session still offers it).
//
// Codex has no such switch yet: codex-acp passes no session options to Codex, which reads
// ~/.codex/config.toml (MCP servers, skills) and AGENTS.md itself.

const CLAUDE_TOOLS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Agent", "ToolSearch", "TodoWrite", "AskUserQuestion"]

export interface ClaudeOptions {
  settings?: Record<string, unknown>
  [option: string]: unknown
}

// The `_meta` for a session on this agent: owlit's isolation, with `options` (a role's) on top
export function sessionMeta(connectorId: string, options: ClaudeOptions = {}): Record<string, unknown> | undefined {
  if (connectorId !== "claude-code") return undefined
  return {
    claudeCode: {
      options: {
        settingSources: [],
        strictMcpConfig: true,
        skills: [],
        plugins: [],
        tools: CLAUDE_TOOLS,
        ...options,
        settings: { disableClaudeAiConnectors: true, ...options.settings },
      },
    },
  }
}
