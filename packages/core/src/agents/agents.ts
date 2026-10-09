import type * as acp from "@agentclientprotocol/sdk"
import { RpcErrorCode, type Connector, type ConnectorStatus, type ProbedConnector } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { RpcFailure } from "../rpc/index.ts"
import type { SettingsStore } from "../settings.ts"
import { resolveExecutable, splitCommand, userPath } from "./command.ts"
import { AcpProcess } from "./process.ts"

const IDLE_MS = 10 * 60_000

// A local agent owlit knows how to start
interface ConnectorDef {
  id: string
  name: string
  description: string
  command: string
  installHint?: string
  builtIn: boolean
}

// The agents most people have, each through its ACP adapter. Their models, modes and efforts come from
// the agent itself when it is checked; nothing about them is hard-coded here.
export const BUILT_IN: ConnectorDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Anthropic's coding agent, via its ACP adapter. Uses your Claude Code sign-in.",
    command: "claude-agent-acp",
    installHint: "npm install -g @agentclientprotocol/claude-agent-acp",
    builtIn: true,
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's Codex CLI, via its ACP adapter. Uses your Codex sign-in.",
    command: "codex-acp",
    installHint: "npm install -g @agentclientprotocol/codex-acp",
    builtIn: true,
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    description: "Google's Gemini CLI, which speaks ACP itself. Uses your Gemini sign-in.",
    command: "gemini --experimental-acp",
    installHint: "npm install -g @google/gemini-cli",
    builtIn: true,
  },
]

export interface AgentsOptions {
  settings: SettingsStore
  // Where agents are checked from (a session needs a folder); not the user's workspace
  probeDir: string
  // The open workspace's root, where agent processes start; the home folder without one
  cwd: () => string | null
  notify: (connector: Connector) => void
  idleMs?: number
  // PATH to look agents up on; by default the login shell's
  searchPath?: () => Promise<string>
}

// Live state on top of what settings remember
interface Live {
  status?: ConnectorStatus
  error?: string
  authenticated?: boolean
}

// The local agents: which exist, whether they work, and the one running process for each
export class Agents {
  private readonly options: AgentsOptions
  private processes = new Map<string, AcpProcess>()
  private live = new Map<string, Live>()

  constructor(options: AgentsOptions) {
    this.options = options
  }

  async list(): Promise<Connector[]> {
    const defs = await this.defs()
    return Promise.all(defs.map((d) => this.connectorOf(d)))
  }

  async add(name: string, command: string): Promise<Connector> {
    if (!splitCommand(command).length) throw new RpcFailure(RpcErrorCode.InvalidParams, "The command is empty.")
    const def = { id: `custom-${randomUUID().slice(0, 8)}`, name: name.trim() || "Custom agent", command: command.trim() }
    await this.options.settings.update((s) => ({ ...s, connectors: { ...s.connectors, custom: [...(s.connectors.custom ?? []), def] } }))
    return this.connectorOf({ ...def, description: "Custom ACP agent", builtIn: false })
  }

  async remove(id: string) {
    const def = await this.def(id)
    if (def.builtIn) throw new RpcFailure(RpcErrorCode.InvalidParams, `${def.name} is built in and can't be removed.`)
    this.processes.get(id)?.stop()
    this.processes.delete(id)
    this.live.delete(id)
    await this.options.settings.update((s) => {
      const probed = { ...s.connectors.probed }
      delete probed[id]
      return { ...s, connectors: { ...s.connectors, custom: (s.connectors.custom ?? []).filter((c) => c.id !== id), probed } }
    })
    return null
  }

  // Starts the agent if needed, then asks it for a session in a scratch folder to learn whether it is
  // signed in and what it offers. The answer is remembered in settings.
  async check(id: string): Promise<Connector> {
    const def = await this.def(id)
    const proc = await this.process(id).catch((error: Error) => {
      if (error instanceof NotInstalled) return null
      throw error
    })
    if (!proc) {
      this.setLive(id, { status: "not_installed", error: `\`${splitCommand(def.command)[0]}\` was not found` })
      return this.connectorOf(def)
    }
    try {
      const init = await proc.initialized()
      await mkdir(this.options.probeDir, { recursive: true })
      const session = await proc.newSession({ cwd: this.options.probeDir, mcpServers: [] }, ignoreSession)
      await proc.closeSession(session.sessionId)
      const probed = probe(init, session)
      await this.options.settings.update((s) => ({ ...s, connectors: { ...s.connectors, probed: { ...s.connectors.probed, [id]: probed } } }))
      this.setLive(id, { status: proc.running ? "connected" : "available", error: undefined, authenticated: true })
    } catch (error) {
      const auth = isAuthError(error)
      this.setLive(id, {
        status: "error",
        authenticated: auth ? false : undefined,
        error: auth ? `Not signed in. Run ${def.name} once in a terminal to sign in.` : messageOf(error),
      })
    }
    return this.connectorOf(def)
  }

  // The running process for an agent, started if needed (T10 opens sessions on it)
  async process(id: string): Promise<AcpProcess> {
    const running = this.processes.get(id)
    if (running) return running
    const def = await this.def(id)
    const [name, ...args] = splitCommand(def.command)
    const searchPath = await (this.options.searchPath ?? userPath)()
    const file = name ? await resolveExecutable(name, searchPath) : null
    if (!file) throw new NotInstalled(def.name)
    const proc = new AcpProcess({
      file,
      args,
      env: { ...process.env, PATH: searchPath },
      cwd: this.options.cwd() ?? homedir(),
      idleMs: this.options.idleMs ?? IDLE_MS,
      onCrash: (detail) => {
        this.setLive(id, { status: "error", error: `${def.name} ${detail}. It starts again with the next message.` })
      },
      onExit: () => {
        if (this.live.get(id)?.status === "connected") this.setLive(id, { status: "available" })
      },
      onStart: () => this.setLive(id, { status: "connected", error: undefined }),
      log: process.env.OWLIT_LOG_AGENTS ? (line) => console.log(`[${id}] ${line}`) : undefined,
    })
    this.processes.set(id, proc)
    return proc
  }

  dispose() {
    for (const proc of this.processes.values()) proc.stop()
    this.processes.clear()
  }

  // ---- inside ----

  private async defs(): Promise<ConnectorDef[]> {
    const { connectors } = await this.options.settings.get()
    return [...BUILT_IN, ...(connectors.custom ?? []).map((c) => ({ ...c, description: "Custom ACP agent", builtIn: false }))]
  }

  private async def(id: string) {
    const def = (await this.defs()).find((d) => d.id === id)
    if (!def) throw new RpcFailure(RpcErrorCode.NotFound, "owlit doesn't know that agent.", { id })
    return def
  }

  private setLive(id: string, patch: Live) {
    this.live.set(id, { ...this.live.get(id), ...patch })
    void this.def(id)
      .then((def) => this.connectorOf(def))
      .then(this.options.notify, () => undefined)
  }

  private async connectorOf(def: ConnectorDef): Promise<Connector> {
    const { connectors } = await this.options.settings.get()
    const probed = connectors.probed?.[def.id]
    const live = this.live.get(def.id) ?? {}
    const fallback = [{ id: "default", name: "Default" }]
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      command: def.command,
      installHint: def.installHint,
      builtIn: def.builtIn,
      // Checked before: ready unless something since says otherwise
      status: live.status ?? (probed ? "available" : "unknown"),
      version: probed?.version,
      authenticated: live.authenticated ?? (probed ? true : undefined),
      error: live.error,
      models: probed?.models.length ? probed.models : fallback,
      modes: probed?.modes.length ? probed.modes : fallback,
      efforts: probed?.efforts.length ? probed.efforts : undefined,
      defaultModelId: probed?.defaultModelId ?? "default",
      defaultModeId: probed?.defaultModeId ?? "default",
      defaultEffortId: probed?.defaultEffortId,
    }
  }
}

class NotInstalled extends Error {}

// A session opened only to look at the agent; nothing it sends matters
const ignoreSession = {
  update() {},
  requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
  readTextFile: async () => ({ content: "" }),
  writeTextFile: async () => ({}),
}

type SelectOption = { value: string; name: string; description?: string | null }

// Models, modes and efforts from what the agent sent: its config options by category (the current
// value is the default), or, for an agent without them, its session modes
export function probe(init: acp.InitializeResponse, session: acp.NewSessionResponse): ProbedConnector {
  const options = session.configOptions ?? []
  const select = (category: string) => {
    const option = options.find((o) => o.category === category && o.type === "select")
    if (!option || option.type !== "select") return null
    const grouped = option.options as (SelectOption | { options: SelectOption[] })[]
    const flat = grouped.flatMap((o) => ("options" in o ? o.options : [o]))
    return {
      items: flat.map((o) => ({ id: o.value, name: o.name, ...(o.description ? { description: o.description } : {}) })),
      current: option.currentValue,
    }
  }
  const model = select("model")
  const effort = select("thought_level")
  const mode = select("mode") ?? (session.modes ? { items: session.modes.availableModes.map((m) => ({ id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}) })), current: session.modes.currentModeId } : null)
  return {
    checkedAt: Date.now(),
    version: init.agentInfo?.version,
    models: model?.items ?? [],
    modes: mode?.items ?? [],
    efforts: effort?.items ?? [],
    defaultModelId: model?.current,
    defaultModeId: mode?.current,
    defaultEffortId: effort?.current,
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : String(error))

// ACP's "auth_required" error
const isAuthError = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code: number }).code === -32000

export const isNotInstalled = (error: unknown) => error instanceof NotInstalled
