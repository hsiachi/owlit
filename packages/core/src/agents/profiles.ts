// What owlit knows about each agent it runs: the one place their names appear, apart from the connector
// definitions (agents.ts) and their icons. Everything else in owlit goes by ACP and by what an agent says
// it can do. An agent owlit knows nothing about gets the defaults: its own mode, owlit's refusals, the
// standard parts of ACP.

import type * as acp from "@agentclientprotocol/sdk"
import type { FileKind, Role } from "@owlit/protocol"
import { FIRST_CHOICE_AGENT } from "@owlit/protocol"
import { OWLIT_DIR } from "../workspace/paths.ts"
import type { ProcessOptions } from "./process.ts"

// The agent owlit picks when nothing else says which (background work, a first chat)
export const FIRST_CHOICE = FIRST_CHOICE_AGENT

// ---- Claude Code: what a session takes from the user's own setup ----

// What an owlit session takes from the agent's own setup: nothing but its sign-in. A user's agent carries
// whatever they set up for their other work (skills, plugins, hooks, MCP servers, subagents, their
// CLAUDE.md, claude.ai connectors), and all of it would reach Owlit: a stuck connector tool can hold a turn
// for minutes, and a probe session was offered over a hundred skills, a screen recorder and Gmail. owlit's
// own MCP server and rules are what the agent should work with. Auto mode doesn't depend on any of this.
//
// Codex takes no session options; what of the user's setup it leaves out is set for its whole process
// (processEnv below). The user's MCP servers and their ~/.codex/AGENTS.md still come through.

// Built-in tools owlit wants. The rest publish or act outside the workspace (Artifact, scheduled and remote
// agents, push notifications, worktrees) or mean nothing here, and listing them means a Claude Code update
// can't add one behind owlit's back. ToolSearch stays because MCP tools may be deferred behind it.
const CLAUDE_TOOLS = ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Agent", "ToolSearch", "TodoWrite", "AskUserQuestion"]

export interface ClaudeOptions {
  settings?: Record<string, unknown>
  [option: string]: unknown
}

// The `_meta` for a session on this agent: owlit's isolation, with `options` (a role's) on top.
// claude-agent-acp passes `_meta.claudeCode.options` to the Agent SDK over its own defaults.
export function sessionMeta(connectorId: string, options: ClaudeOptions = {}): Record<string, unknown> | undefined {
  if (connectorId !== "claude-code") return undefined
  return {
    claudeCode: {
      options: {
        // None of ~/.claude/settings.json, .claude/ or CLAUDE.md, and with them the user's hooks, plugins,
        // skills and subagents; skills [] and plugins [] say so outright
        settingSources: [],
        // Only the MCP servers owlit passes, claude.ai connectors left out (disableClaudeAiConnectors again)
        strictMcpConfig: true,
        skills: [],
        plugins: [],
        tools: CLAUDE_TOOLS,
        ...options,
        // Claude Code's own memory (~/.claude/projects/<folder>/memory/) stays on without settingSources,
        // out of the user's sight and outside the workspace, so each write asked like an edit. Owlit keeps
        // its own memory in the workspace (memory.ts); autoDreamEnabled false stops the background tidying.
        settings: { disableClaudeAiConnectors: true, autoMemoryEnabled: false, autoDreamEnabled: false, ...options.settings },
      },
    },
  }
}

// What an agent's process is started with beyond the user's own environment. codex-acp sends CODEX_CONFIG
// (JSON) with every new session as config over the user's ~/.codex/config.toml, so owlit's isolation for
// Codex goes there, on top of any CODEX_CONFIG the user set (checked with codex-acp 2.2.1, Codex 0.160, by
// the session's rollout file). Merging only adds to the user's config, which is why their MCP servers stay:
// `mcp_servers.<name>.enabled` false would be wiped in some sessions, since codex-acp sends owlit's own
// server as the whole `mcp_servers` key and Codex applies keys in no fixed order. codex-acp's own title
// thread doesn't get CODEX_CONFIG either (processSetup).
export function processEnv(connectorId: string, env: NodeJS.ProcessEnv): Record<string, string> {
  if (connectorId !== "codex") return {}
  let config: Record<string, unknown> = {}
  try {
    const own: unknown = env.CODEX_CONFIG ? JSON.parse(env.CODEX_CONFIG) : {}
    if (own && typeof own === "object" && !Array.isArray(own)) config = own as Record<string, unknown>
  } catch {
    // Not JSON: codex-acp would fail on it anyway; owlit's own replaces it
  }
  const section = (key: string) => (config[key] && typeof config[key] === "object" ? (config[key] as Record<string, unknown>) : {})
  return {
    CODEX_CONFIG: JSON.stringify({
      ...config,
      features: {
        ...section("features"),
        // Codex keeps memories of every project in ~/.codex/memories, written in the background
        memories: false,
        // The user's plugins (with their skills and MCP servers) and their ChatGPT connectors (Gmail, Drive,
        // publishing sites); tool_suggest would offer to install more
        plugins: false,
        apps: false,
        tool_suggest: false,
        // Tools that act outside the workspace
        computer_use: false,
        browser_use: false,
        in_app_browser: false,
        // With notify [], nothing the user set to run at a turn's events runs for owlit's
        hooks: false,
      },
      memories: { ...section("memories"), generate_memories: false, use_memories: false },
      // The session isn't told of any skill (the user's, their plugins', the workspace's .agents/skills or
      // Codex's own), and has no tool to look one up
      skills: { ...section("skills"), include_instructions: false },
      // No AGENTS.md from the workspace. ~/.codex/AGENTS.md still comes; no config key stops it.
      project_doc_max_bytes: 0,
      notify: [],
    }),
  }
}

// What else an agent's process is set up with. After a session's first turn codex-acp starts a thread of
// its own, with no config at all, to make up a title, so it started the user's MCP servers and loaded
// their plugins and ChatGPT connectors for a turn told only to write a title. It skips that for a session
// with a title given to it, so each of owlit's is named "Owlit" as soon as it opens (owlit names chats
// itself; the name is what the user's Codex lists it by). Naming takes codex-acp's `_session/rename`, which
// it offers only to a client that says it keeps a session index (JetBrains AIR's extension); owlit uses no
// other part of it (codex-acp 2.2.1).
export function processSetup(connectorId: string): Pick<ProcessOptions, "clientMeta" | "opened"> {
  if (connectorId !== "codex") return {}
  return {
    clientMeta: { jetbrains: { air: { version: 1, capabilities: ["sessionIndex"] } } },
    opened: (sessionId) => ({ method: "_session/rename", params: { sessionId, title: "Owlit" } }),
  }
}

// ---- Roles, as each agent's own controls ----

// What a role means on each agent. owlit relies on one thing: an agent asks, with the diff, before it
// changes the user's files. Each agent is held to that with its own controls, since none of them sends
// its edits through ACP's fs/write_text_file (claude-agent-acp 0.88, codex-acp 2.2.1):
// - Claude Code runs in its auto mode. Its own permission rules make its file-editing tools ask (or
//   refuse) even there, and its sandbox stops shell commands writing the workspace, so a `sed` or an
//   `echo >>` fails and it falls back to the editing tool, which asks. Its auto classifier still judges
//   everything else (commands, the network).
// - Codex's read-only mode already asks, with the patch, before any edit, and its sandbox makes a shell
//   command that writes ask first; its auto-review mode lets it work and has its own reviewer judge what
//   is risky.
// - The Owlit engine is told the role and holds to it itself: a Reviewer gets no edit tools, an Assistant
//   asks with the diff through ACP, and every write comes through ACP's fs, so owlit records it.
// - Any other agent keeps the mode it starts in; owlit still refuses what a Reviewer may not do.
export interface Guard {
  // The agent's own modes to set, in order of preference; the first it offers wins
  modes: string[]
  // Sent with session/new and session/load; changing it rebuilds the agent's session
  meta?: Record<string, unknown>
}

const CLAUDE_EDIT_TOOLS = ["Edit", "Write"]

// owlit's own part of the workspace, which every role changes only through owlit's tools: as Edit / Write
// deny rules (gitignore patterns from the session's cwd, the workspace) and as paths the sandbox keeps
// shell commands from writing. A deny wins over any allow, so a paper's note (library/papers/<id>/note.md,
// the user's) can't be carved out of library/ here: it is edited through owlit alone.
const OWN_PATTERNS = [`${OWLIT_DIR}/**`, "library/**"]
const ownRules = () => CLAUDE_EDIT_TOOLS.flatMap((tool) => OWN_PATTERNS.map((pattern) => `${tool}(${pattern})`))
const ownPaths = (roots: string[]) => roots.flatMap((root) => [`${root}/${OWLIT_DIR}`, `${root}/library`])

export function guardFor(connectorId: string, role: Role, roots: string[]): Guard {
  if (connectorId === "claude-code") {
    // Without auto mode (a plan or model that lacks it) the default mode asks for everything, which only
    // makes a Co-author ask more
    const modes = ["auto", "default"]
    const permissions = role === "reviewer" ? { deny: [...CLAUDE_EDIT_TOOLS, ...ownRules()] } : role === "assistant" ? { ask: CLAUDE_EDIT_TOOLS, deny: ownRules() } : { deny: ownRules() }
    const sandbox = {
      enabled: true,
      // Without a sandbox (Windows), commands could write where the role says they can't: the turn fails
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      // A Co-author's commands write the user's docs; the others' write nothing in the workspace
      filesystem: { denyWrite: role === "coauthor" ? ownPaths(roots) : roots },
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

// A tool call's tool, as the agent names it: ACP's own name (Tool Call Name RFD; claude-agent-acp ≥0.88
// sends it), else Claude Code's older _meta.claudeCode.toolName
export function toolNameOf(call: { name?: string | null; _meta?: Record<string, unknown> | null }): string | undefined {
  const standard = typeof call.name === "string" && call.name ? call.name : undefined
  const claude = (call._meta?.claudeCode as { toolName?: unknown } | undefined)?.toolName
  return standard ?? (typeof claude === "string" && claude ? claude : undefined)
}

// The report an agent's own agent hands back, when this step is how it does: Claude Code's agents end with
// a SubagentHandback call whose input is the report (claude-agent-acp 0.88); the step
// itself only says "Report delivered"
export function handbackOf(call: { name?: string | null; _meta?: Record<string, unknown> | null; rawInput?: unknown }): string | undefined {
  if (toolNameOf(call) !== "SubagentHandback") return undefined
  const message = (call.rawInput as { message?: unknown } | undefined)?.message
  return typeof message === "string" && message.trim() ? message.trim() : undefined
}

// ---- When an agent's own turn is over ----

// Whether this update closes a turn of the agent's own, one no prompt waits for. Claude Code goes on after
// its prompt has returned: when a background agent reports back after end_turn, the report starts a turn of
// its own, and its answer streams in with no prompt open, seconds after end_turn (claude-agent-acp 0.88).
// Each of its turns, those included, ends with a usage_update that carries the session's cost, sent right
// after the turn's last words (its `result` message; also sent once more for each finished background
// task, which says nothing new). An agent this says nothing for is waited out instead (turns.ts,
// LATE_QUIET_MS).
export function ownTurnOver(connectorId: string, u: acp.SessionUpdate): boolean {
  return connectorId === "claude-code" && u.sessionUpdate === "usage_update" && !!u.cost
}

// A tool call to owlit's own MCP server: Codex says so in rawInput (and titles it mcp.owlit.<tool>),
// Claude Code titles it mcp__owlit__<tool>
export function isOwlitCall(call: { title?: string | null; rawInput?: unknown }) {
  const input = call.rawInput as { server?: unknown } | undefined
  return input?.server === "owlit" || OWLIT_PREFIX.test(call.title ?? "")
}

const OWLIT_PREFIX = /^mcp(\.|__)owlit(\.|__)/

// A tool call's title without the prefix either agent puts on owlit's tools: library_get for
// mcp__owlit__library_get and mcp.owlit.library_get alike
export const bareToolTitle = (title: string) => title.replace(OWLIT_PREFIX, "")

// ---- Files the user attaches ----

// Every agent gets an attached file as a link to owlit's copy and reads it with its own tools, so owlit
// needn't convert anything for them: Claude Code (claude-agent-acp 0.88) reads a PDF with its Read
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
// whole prompt when the chat's model takes text only (codex-acp 2.2.1). Its listed models take images;
// the open-weight gpt-oss models (Codex's --oss) and Codex-Spark are taken to be
// text-only, so they get the link alone, which loses nothing. The Owlit engine knows its models and leaves
// the picture out itself, with a word to the model, when one takes text only.
export function sendsPictures(connectorId: string, init: Pick<acp.InitializeResponse, "agentCapabilities">, modelId?: string) {
  if (!init.agentCapabilities?.promptCapabilities?.image) return false
  if (connectorId === "codex" && modelId && /gpt-oss|codex-spark/i.test(modelId)) return false
  return true
}

const ENGINE = "owlit-engine"
