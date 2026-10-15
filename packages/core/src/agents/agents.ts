import { t } from "@lingui/core/macro"
import type * as acp from "@agentclientprotocol/sdk"
import { RpcErrorCode, type Connector, type ConnectorStatus, type ProbedConnector, type SignIn, type SignInMethod } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { RpcFailure } from "../rpc/index.ts"
import type { SettingsStore } from "../settings.ts"
import { resolveExecutable, splitCommand, userPath } from "./command.ts"
import { AcpProcess, endingSentence, isAuthError } from "./process.ts"
import { cannotRead } from "./profiles.ts"
import { AgentSetups, type SetupOptions } from "./setup.ts"
import { messageOf } from "../util.ts"

const IDLE_MS = 10 * 60_000

// How long a check waits for the agent's own report of its sign-in (claude-agent-acp runs `claude auth
// status` for it, about 0.1 s here, with a 5 s limit of its own). Past this, the check goes by the
// session alone, as for agents that don't report one.
const AUTH_STATUS_WAIT_MS = 3000

// A local agent owlit knows how to start
interface ConnectorDef {
  id: string
  name: string
  description: string
  command: string
  installHint?: string
  builtIn: boolean
  // Started as given instead of looked up on PATH (the Owlit engine, which ships inside owlit)
  launch?: Launch
}

export interface Launch {
  command: string
  args: string[]
  env?: Record<string, string>
}

export const ENGINE_ID = "owlit-engine"

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

// owlit's own agent (packages/owlit-agent), when the shell says how to start it. It signs in inside owlit,
// so it carries its sign-ins rather than a command to run in a terminal.
const engineDef = (launch: Launch): ConnectorDef => ({
  id: ENGINE_ID,
  name: "Owlit engine (Beta)",
  description: "owlit's own agent, built on Pi. Signs in with ChatGPT or an API key.",
  command: "owlit-agent",
  builtIn: true,
  launch,
})

// What a user runs to sign in, where it isn't the command owlit starts
const BUILT_IN_SIGN_IN: Record<string, string> = { "claude-code": "claude", codex: "codex" }

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
  // The system proxy as environment variables, asked before each agent or npm starts (proxy.ts)
  proxyEnv?: () => Promise<Record<string, string>>
  // How to start the Owlit engine; without it the engine isn't offered
  engine?: Launch
  // Where and how owlit sets up its own copy of Claude Code's and Codex's adapters; without it the user
  // installs them
  setup?: Omit<SetupOptions, "changed" | "searchPath" | "proxyEnv">
}

// Live state on top of what settings remember
interface Live {
  status?: ConnectorStatus
  error?: string
  authenticated?: boolean
  signInMethods?: SignInMethod[]
  signIns?: SignIn[]
}

// The local agents: which exist, whether they work, and the one running process for each
export class Agents {
  private readonly options: AgentsOptions
  private processes = new Map<string, AcpProcess>()
  private live = new Map<string, Live>()
  private readonly setups: AgentSetups | undefined

  constructor(options: AgentsOptions) {
    this.options = options
    this.setups =
      options.setup &&
      new AgentSetups({
        ...options.setup,
        searchPath: options.searchPath ?? userPath,
        proxyEnv: options.proxyEnv,
        changed: (id) => void this.def(id).then((def) => this.connectorOf(def)).then(options.notify, () => undefined),
      })
  }

  async list(): Promise<Connector[]> {
    const defs = await this.defs()
    return Promise.all(defs.map((d) => this.connectorOf(d)))
  }

  async add(name: string, command: string): Promise<Connector> {
    if (!splitCommand(command).length) throw new RpcFailure(RpcErrorCode.InvalidParams, t`The command is empty.`)
    const def = { id: `custom-${randomUUID().slice(0, 8)}`, name: name.trim() || t`Custom agent`, command: command.trim() }
    await this.options.settings.update((s) => ({ ...s, connectors: { ...s.connectors, custom: [...(s.connectors.custom ?? []), def] } }))
    return this.connectorOf({ ...def, description: "Custom ACP agent", builtIn: false })
  }

  async remove(id: string) {
    const def = await this.def(id)
    const agent = def.name
    if (def.builtIn) throw new RpcFailure(RpcErrorCode.InvalidParams, t`${agent} is built in and can't be removed.`)
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
    await this.setups?.look(id)
    const proc = await this.process(id).catch((error: Error) => {
      if (error instanceof NotInstalled) return null
      throw error
    })
    if (!proc) {
      const command = splitCommand(def.command)[0]
      this.setLive(id, { status: "not_installed", error: t`\`${command}\` was not found` })
      return this.connectorOf(def)
    }
    try {
      const init = await proc.initialized()
      if (def.launch) this.setLive(id, { signInMethods: signInMethodsOf(init), signIns: await signInsOf(proc) })
      await mkdir(this.options.probeDir, { recursive: true })
      const session = await proc.newSession({ cwd: this.options.probeDir, mcpServers: [] }, ignoreSession)
      await proc.closeSession(session.sessionId)
      const probed = probe(init, session)
      await this.options.settings.update((s) => ({ ...s, connectors: { ...s.connectors, probed: { ...s.connectors.probed, [id]: probed } } }))
      // A signed-out Claude Code opens a session all the same and only refuses the first prompt (seen
      // 2026-10-13: the welcome check said "Owlit will use Claude Code", the first message stopped); its
      // adapter does say so, in a report of its own, so the check asks for that before calling it ready
      if ((await proc.authStatus(AUTH_STATUS_WAIT_MS))?.kind === "none") {
        await this.signedOut(id)
        return this.connectorOf(def)
      }
      this.setLive(id, { status: proc.running ? "connected" : "available", error: undefined, authenticated: true })
    } catch (error) {
      const auth = isAuthError(error)
      if (auth) await this.signedOut(id)
      else this.setLive(id, { status: "error", authenticated: undefined, error: messageOf(error) })
    }
    return this.connectorOf(def)
  }

  // The agent said it needs a sign-in (when checked, or in the middle of a turn); returns what to tell the user
  async signedOut(id: string) {
    const def = await this.def(id)
    const agent = def.name
    const command = splitCommand(BUILT_IN_SIGN_IN[id] ?? def.command)[0]
    const error = def.launch
      ? t`${agent} isn't signed in. Sign in under Settings › Agents, then try again.`
      : t`${agent} isn't signed in. Run ${command} in a terminal to sign in, then try again.`
    this.setLive(id, { status: "error", authenticated: false, error })
    return error
  }

  // The agent's service refused a request it was signed in for (a 403: the network, a proxy, the region or
  // the account), which signing in again doesn't fix; the agent isn't marked signed out
  async refused(id: string) {
    const agent = (await this.def(id)).name
    return t`${agent}'s service refused the request (403). If ${agent} is signed in, this is usually the network or a proxy; try again in a moment.`
  }

  async nameOf(id: string) {
    return (await this.def(id).catch(() => null))?.name ?? t({ message: "The agent", comment: "stands in for an agent's name at the start of a sentence: The agent ran into a problem." })
  }

  // One of the agent's own sign-ins. A browser sign-in waits for the user to finish there.
  async signIn(id: string, methodId: string, apiKey?: string): Promise<Connector> {
    const proc = await this.process(id)
    await proc.authenticate({ methodId, ...(apiKey ? { _meta: { apiKey } } : {}) }).catch((error) => {
      throw new RpcFailure(RpcErrorCode.Unavailable, messageOf(error))
    })
    return this.check(id)
  }

  async signOut(id: string, methodId?: string): Promise<Connector> {
    const proc = await this.process(id)
    await proc.logout(methodId ? { _meta: { owlit: { methodId } } } : {})
    // Its open sessions were made with the old sign-in
    proc.stop()
    this.processes.delete(id)
    return this.check(id)
  }

  // Fetches owlit's own copy of the agent's adapter, or a newer one. The agent's process keeps running
  // on the old copy until it next starts; one that wasn't there is checked as soon as it is.
  async setUp(id: string): Promise<Connector> {
    const def = await this.def(id)
    if (!this.setups) throw new RpcFailure(RpcErrorCode.Unavailable, t`owlit can't set agents up here.`)
    void this.setups.setUp(id).then(async () => {
      if (!this.processes.get(id)?.running && (await this.setups?.installed(id))) {
        this.processes.get(id)?.stop()
        this.processes.delete(id)
        await this.check(id).catch(() => undefined)
      }
    })
    return this.connectorOf(def)
  }

  async cancelSetUp(id: string): Promise<Connector> {
    this.setups?.cancel(id)
    return this.connectorOf(await this.def(id))
  }

  // The running process for an agent, started if needed (T10 opens sessions on it). owlit's own copy of
  // an adapter comes before one on PATH: it is the one owlit set up and keeps up to date.
  async process(id: string): Promise<AcpProcess> {
    const running = this.processes.get(id)
    if (running) return running
    const def = await this.def(id)
    const own = !def.launch && this.options.setup ? await this.setups?.installed(id) : null
    const launch: Launch | undefined = def.launch ?? (own && this.options.setup ? { ...this.options.setup.node, args: [...this.options.setup.node.args, own.entry] } : undefined)
    const [name, ...args] = launch ? [launch.command, ...launch.args] : splitCommand(def.command)
    const searchPath = await (this.options.searchPath ?? userPath)()
    const file = launch ? launch.command : name ? await resolveExecutable(name, searchPath) : null
    if (!file) throw new NotInstalled(def.name)
    const proc = new AcpProcess({
      file,
      args,
      env: { ...process.env, PATH: searchPath, ...launch?.env },
      freshEnv: this.options.proxyEnv,
      cwd: this.options.cwd() ?? homedir(),
      idleMs: this.options.idleMs ?? IDLE_MS,
      onCrash: (ending) => {
        this.setLive(id, { status: "error", error: endingSentence(def.name, ending, true) })
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
    const engine = this.options.engine ? [engineDef(this.options.engine)] : []
    return [...BUILT_IN, ...engine, ...(connectors.custom ?? []).map((c) => ({ ...c, description: "Custom ACP agent", builtIn: false }))]
  }

  private async def(id: string) {
    const def = (await this.defs()).find((d) => d.id === id)
    if (!def) throw new RpcFailure(RpcErrorCode.NotFound, t`owlit doesn't know that agent.`, { id })
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
    const stored = connectors.probed?.[def.id]
    // Probes saved before the tidying are tidied as they are read
    const probed = stored ? tidy(stored) : undefined
    const live = this.live.get(def.id) ?? {}
    const fallback = [{ id: "default", name: t({ message: "Default", comment: "the model or mode an agent uses when none is picked" }) }]
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      command: def.command,
      installHint: def.installHint,
      signIn: def.builtIn && !def.launch ? splitCommand(BUILT_IN_SIGN_IN[def.id] ?? def.command)[0] : undefined,
      signInMethods: live.signInMethods,
      signIns: live.signIns,
      ...(def.launch ? { signsInHere: true } : {}),
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
      ...(cannotRead(def.id).length ? { cannotRead: cannotRead(def.id) } : {}),
      ...(this.setups && def.builtIn && !def.launch ? await this.setups.view(def.id).then((setup) => (setup ? { setup } : {})) : {}),
    }
  }
}

class NotInstalled extends Error {}

// The sign-ins an agent runs itself; ones it would run in a terminal aren't offered
function signInMethodsOf(init: acp.InitializeResponse): SignInMethod[] {
  return (init.authMethods ?? []).flatMap((m) => {
    if ("type" in m && m.type === "terminal") return []
    const owlit = (m._meta as { owlit?: { apiKey?: boolean; provider?: string } } | null | undefined)?.owlit
    return [{ id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}), ...(owlit?.apiKey ? { apiKey: true } : {}), ...(owlit?.provider ? { provider: owlit.provider } : {}) }]
  })
}

async function signInsOf(proc: AcpProcess): Promise<SignIn[]> {
  const answer = await proc.extMethod("_owlit/sign_ins").catch(() => ({ signIns: [] }))
  return (answer.signIns as SignIn[] | undefined) ?? []
}

// A session opened only to look at the agent; nothing it sends matters
const ignoreSession = {
  update() {},
  requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
  readTextFile: async () => ({ content: "" }),
  writeTextFile: async () => ({}),
  createElicitation: async () => ({ action: "decline" as const }),
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
    const flat = grouped.flatMap((o) => ("options" in o ? o.options.map((x) => ({ ...x, group: (o as { name?: string }).name })) : [o as SelectOption & { group?: string }]))
    return {
      items: flat.map((o) => ({ id: o.value, name: o.name, ...(o.description ? { description: o.description } : {}), ...(o.group ? { group: o.group } : {}) })),
      current: option.currentValue,
    }
  }
  const model = select("model")
  const effort = select("thought_level")
  const mode = select("mode") ?? (session.modes ? { items: session.modes.availableModes.map((m) => ({ id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}) })), current: session.modes.currentModeId } : null)
  return tidy({
    checkedAt: Date.now(),
    version: init.agentInfo?.version,
    models: model?.items ?? [],
    modes: mode?.items ?? [],
    efforts: effort?.items ?? [],
    defaultModelId: model?.current,
    defaultModeId: mode?.current,
    defaultEffortId: effort?.current,
  })
}

type Item = ProbedConnector["models"][number]

// The pickers list real choices only. An entry with the id "default" stands for whatever the agent picks
// itself (Claude Code sends "Default (recommended)", described as "Opus", besides Opus 5.5 itself), so it
// would show the same model twice: it is dropped, and the default becomes the model it points at. Names
// lose a "(recommended)" tag, and an effort spelled "Xhigh" reads "Extra high".
export function tidy(probed: ProbedConnector): ProbedConnector {
  const pointer = probed.models.find((m) => m.id === "default")
  const models = probed.models.filter((m) => m.id !== "default").map(clean)
  const target = (key?: string) => {
    if (!key) return undefined
    const k = key.trim().toLowerCase()
    return models.find((m) => m.id.toLowerCase() === k) ?? models.find((m) => m.name.toLowerCase().startsWith(k))
  }
  const defaultModelId =
    probed.defaultModelId && probed.defaultModelId !== "default" && models.some((m) => m.id === probed.defaultModelId)
      ? probed.defaultModelId
      : (target(pointer?.description) ?? models[0])?.id
  const efforts = probed.efforts.filter((e) => e.id !== "default").map(clean)
  const defaultEffortId = efforts.some((e) => e.id === probed.defaultEffortId) ? probed.defaultEffortId : efforts.find((e) => e.id === "medium")?.id ?? efforts[0]?.id
  return { ...probed, models, efforts, defaultModelId, defaultEffortId }
}

const clean = (item: Item): Item => ({ ...item, name: item.id === "xhigh" ? "Extra high" : item.name.replace(/\s*\(recommended\)\s*$/i, "") })
