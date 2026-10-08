import type { Connector } from "../types"

// Built-in connectors for the common local coding agents, all speaking ACP over stdio
export const builtInConnectors: Connector[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's coding agent, via the claude-code-acp adapter",
    command: "npx @zed-industries/claude-code-acp",
    installHint: "npm install -g @anthropic-ai/claude-code",
    builtIn: true,
    status: "unknown",
    models: [
      { id: "claude-opus-5-5", name: "Opus 5.5", description: "Most capable" },
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5", description: "Balanced" },
      { id: "claude-haiku-5-5", name: "Haiku 5.5", description: "Fastest" },
    ],
    modes: [
      { id: "default", name: "Always Ask", description: "Ask before every edit or command" },
      { id: "acceptEdits", name: "Accept Edits", description: "Apply file edits without asking" },
      { id: "plan", name: "Plan", description: "Read and plan only, no changes" },
      { id: "bypassPermissions", name: "Bypass Permissions", description: "Run everything without asking" },
    ],
    efforts: [
      { id: "low", name: "Low", description: "Quick, lighter reasoning" },
      { id: "medium", name: "Medium", description: "Balanced" },
      { id: "high", name: "High", description: "Thinks longer on hard problems" },
    ],
    defaultModelId: "claude-sonnet-5-5",
    defaultModeId: "default",
    defaultEffortId: "medium",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI Codex CLI, via the codex-acp adapter",
    command: "npx @zed-industries/codex-acp",
    installHint: "npm install -g @openai/codex",
    builtIn: true,
    status: "unknown",
    models: [
      { id: "gpt-5-codex", name: "GPT-5 Codex" },
      { id: "gpt-5", name: "GPT-5" },
    ],
    modes: [
      { id: "read-only", name: "Read Only", description: "No edits or commands" },
      { id: "auto", name: "Auto", description: "Edit in the workspace, ask for the rest" },
      { id: "full-access", name: "Full Access", description: "No approvals" },
    ],
    efforts: [
      { id: "low", name: "Low" },
      { id: "medium", name: "Medium" },
      { id: "high", name: "High" },
      { id: "xhigh", name: "Extra high" },
    ],
    defaultModelId: "gpt-5-codex",
    defaultModeId: "auto",
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
    modes: [
      { id: "default", name: "Default", description: "Ask before edits" },
      { id: "auto_edit", name: "Auto Edit", description: "Apply edits without asking" },
      { id: "yolo", name: "YOLO", description: "No approvals" },
    ],
    defaultModelId: "gemini-2.5-pro",
    defaultModeId: "default",
  },
]

// What the mock "check" discovers on this machine
export const mockCheckResults: Record<string, Partial<Connector>> = {
  "claude-code": { status: "available", version: "2.0.14", authenticated: true },
  codex: { status: "not_installed", error: "`codex` not found on PATH" },
  "gemini-cli": { status: "not_installed", error: "`gemini` not found on PATH" },
}
