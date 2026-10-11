// What owlit knows about each agent it runs: the one place their names appear, apart from the connector
// definitions (agents.ts) and their icons. Everything else in owlit goes by ACP and by what an agent says
// it can do. An agent owlit knows nothing about gets the defaults: its own mode, owlit's refusals, the
// standard parts of ACP. (Rule: README of the tasks folder, "引擎能力"; 2026-10-11.)

import type * as acp from "@agentclientprotocol/sdk"
import type { FileKind, Role } from "@owlit/protocol"
import { FIRST_CHOICE_AGENT } from "@owlit/protocol"

// The agent owlit picks when nothing else says which (background work, a first chat)
export const FIRST_CHOICE = FIRST_CHOICE_AGENT

// ---- Claude Code: what a session takes from the user's own setup ----

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

// ---- Roles, as each agent's own controls ----

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
// - The Owlit engine is told the role and holds to it itself: a Reviewer gets no edit tools, an Assistant
//   asks with the diff through ACP, and every write comes through ACP's fs, so owlit keeps a version.
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
    if (role === "coauthor") return { modes, meta: sessionMeta(connectorId) }
    const permissions = role === "reviewer" ? { deny: CLAUDE_EDIT_TOOLS } : { ask: CLAUDE_EDIT_TOOLS }
    const sandbox = {
      enabled: true,
      // Without a sandbox (Windows), commands could write where the role says they can't: the turn fails
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyWrite: roots },
    }
    return { modes, meta: sessionMeta(connectorId, { settings: { permissions }, sandbox }) }
  }
  if (connectorId === "codex") return { modes: role === "coauthor" ? ["agent", "workspace-write"] : ["read-only"] }
  // The Owlit engine (packages/owlit-agent) takes the role itself and holds its file tools to it
  if (connectorId === ENGINE) return { modes: [], meta: { owlit: { role } } }
  return { modes: [] }
}


// ---- Background work ----

// The session options for a background run: the Owlit engine calls owlit's tools itself rather than asking
// for each, so it is told which it may offer the model (patterns over their names); Claude Code gets its
// isolation as in a chat
export function backgroundMeta(connectorId: string, tools: string[]): Record<string, unknown> | undefined {
  if (connectorId === ENGINE) return { owlit: { role: "reviewer", background: { tools } } }
  return sessionMeta(connectorId)
}

// ---- Reading what an agent sends ----

// A tool call's tool, as the agent names it: ACP's own name (Tool Call Name RFD, settled 2026-09-17;
// claude-agent-acp 0.88 sends it), else Claude Code's older _meta.claudeCode.toolName
export function toolNameOf(call: { name?: string | null; _meta?: Record<string, unknown> | null }): string | undefined {
  const standard = typeof call.name === "string" && call.name ? call.name : undefined
  const claude = (call._meta?.claudeCode as { toolName?: unknown } | undefined)?.toolName
  return standard ?? (typeof claude === "string" && claude ? claude : undefined)
}

// The report an agent's own agent hands back, when this step is how it does: Claude Code's agents end with
// a SubagentHandback call whose input is the report (checked 2026-10-11, claude-agent-acp 0.88); the step
// itself only says "Report delivered"
export function handbackOf(call: { name?: string | null; _meta?: Record<string, unknown> | null; rawInput?: unknown }): string | undefined {
  if (toolNameOf(call) !== "SubagentHandback") return undefined
  const message = (call.rawInput as { message?: unknown } | undefined)?.message
  return typeof message === "string" && message.trim() ? message.trim() : undefined
}

// ---- When an agent's own turn is over ----

// Whether this update closes a turn of the agent's own, one no prompt waits for. Claude Code goes on after
// its prompt has returned: when a background agent reports back after end_turn, the report starts a turn of
// its own, and its answer streams in with no prompt open (checked 2026-10-11, claude-agent-acp 0.88: two
// parallel agents, end_turn at 18.1s, the real answer from 19.9s). Each of its turns, those included, ends
// with a usage_update that carries the session's cost, sent right after the turn's last words (its
// `result` message; also sent once more for each finished background task, which says nothing new). An
// agent this says nothing for is waited out instead (turns.ts, LATE_QUIET_MS).
export function ownTurnOver(connectorId: string, u: acp.SessionUpdate): boolean {
  return connectorId === "claude-code" && u.sessionUpdate === "usage_update" && !!u.cost
}

// A tool call to owlit's own MCP server: Codex says so in rawInput (and titles it mcp.owlit.<tool>),
// Claude Code titles it mcp__owlit__<tool>
export function isOwlitCall(call: { title?: string | null; rawInput?: unknown }) {
  const input = call.rawInput as { server?: unknown } | undefined
  return input?.server === "owlit" || /^mcp(\.|__)owlit(\.|__)/.test(call.title ?? "")
}

// ---- Files the user attaches ----

// Every agent gets an attached file as a link to owlit's copy and reads it with its own tools (checked
// 2026-10-11, attachments-proposal.md): Claude Code (claude-agent-acp 0.88) reads a PDF with its Read
// tool and a Word file by unzipping it; Codex (codex-acp 2.2.1) reads a PDF with pdftotext and a Word file
// by unzipping it. The Owlit engine has no shell: it reads text files with its own tool, PDFs through
// owlit's docs_read, and sees images when its model does, but can't open a Word file or anything else
// that isn't text. An agent owlit knows nothing about is assumed to manage, since it can't be checked.
export function cannotRead(connectorId: string): FileKind[] {
  if (connectorId === ENGINE) return ["word", "other"]
  return []
}

// Model APIs refuse other image types, and images over 5 MB (Anthropic's limit, the lowest of them);
// such an image still goes as a link, which the agent can open itself
export const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024

// Whether an attached image also goes to the agent as a picture (an ACP image block), so its model sees
// it without a step: when the agent says it takes images. Codex says so for every model, but refuses the
// whole prompt when the chat's model takes text only (codex-acp 2.2.1). Every model it listed on
// 2026-10-11 takes images; the open-weight gpt-oss models (Codex's --oss) and Codex-Spark are taken to be
// text-only, so they get the link alone, which loses nothing. The Owlit engine knows its models and leaves
// the picture out itself, with a word to the model, when one takes text only.
export function sendsPictures(connectorId: string, init: Pick<acp.InitializeResponse, "agentCapabilities">, modelId?: string) {
  if (!init.agentCapabilities?.promptCapabilities?.image) return false
  if (connectorId === "codex" && modelId && /gpt-oss|codex-spark/i.test(modelId)) return false
  return true
}

const ENGINE = "owlit-engine"
