import type { Connector } from "@owlit/protocol"

// Built-in connectors for the common local coding agents, all speaking ACP over stdio. Only for the
// browser mock (pnpm dev:web); the desktop app gets the real list from core (agents/agents.ts).
export const builtInConnectors: Connector[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's coding agent, via its ACP adapter",
    command: "claude-agent-acp",
    installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
    builtIn: true,
    status: "unknown",
    models: [
      { id: "claude-opus-5-5", name: "Opus 5.5", description: "Most capable" },
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "Balanced" },
      { id: "claude-haiku-5-5", name: "Haiku 5.5", description: "Fastest" },
    ],
    efforts: [
      { id: "low", name: "Low", description: "Quick, lighter reasoning" },
      { id: "medium", name: "Medium", description: "Balanced" },
      { id: "high", name: "High", description: "Thinks longer on hard problems" },
    ],
    defaultModelId: "claude-sonnet-5-5",
    defaultEffortId: "medium",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex CLI, via its ACP adapter",
    command: "codex-acp",
    installHint: "npm install -g @agentclientprotocol/codex-acp",
    builtIn: true,
    status: "unknown",
    models: [
      { id: "gpt-5-codex", name: "GPT-5 Codex" },
      { id: "gpt-5", name: "GPT-5" },
    ],
    efforts: [
      { id: "low", name: "Low" },
      { id: "medium", name: "Medium" },
      { id: "high", name: "High" },
      { id: "xhigh", name: "Extra high" },
    ],
    defaultModelId: "gpt-5-codex",
    defaultEffortId: "medium",
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's Gemini CLI, native ACP support",
    command: "gemini --experimental-acp",
    installHint: "npm install -g @google/gemini-cli",
    builtIn: true,
    status: "unknown",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    ],
    defaultModelId: "gemini-2.5-pro",
  },
]

// What the mock "check" discovers on this machine
export const mockCheckResults: Record<string, Partial<Connector>> = {
  "claude-code": { status: "available", version: "2.0.14", authenticated: true },
  codex: { status: "not_installed", error: "`codex` not found on PATH" },
  "gemini-cli": { status: "not_installed", error: "`gemini` not found on PATH" },
}
