import * as acp from "@agentclientprotocol/sdk"
import { t } from "@lingui/core/macro"
import { spawn, type ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"

// What owlit does for one ACP session: hear its updates, answer its permission requests, serve its
// file reads and writes. Registered per session; the process routes each request by session id.
//
// An agent may hand part of the work to agents of its own, each in a session of its own (ACP's draft
// subagents, which owlit says it understands). Those sessions are never registered: what comes from one
// goes to the handler of the session it works for, with `agentId` naming it, and `agent` hears it start
// and finish.
export interface SessionHandler {
  update(notification: acp.SessionNotification, agentId?: string): void
  requestPermission(request: acp.RequestPermissionRequest, agentId?: string): Promise<acp.RequestPermissionResponse>
  readTextFile(request: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse>
  writeTextFile(request: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse>
  // A form the agent asks the user to fill in (Claude Code's AskUserQuestion)
  createElicitation(request: acp.CreateElicitationRequest, agentId?: string): Promise<acp.CreateElicitationResponse>
  agent?(notice: AgentNotice): void
}

// An agent working for a session: announced (with its task, as the agent named it), or its state changed
export type AgentNotice = { kind: "started"; agentId: string; title: string } | { kind: "state"; agentId: string; state: string }

// Whose sign-in the agent's process runs on, as claude-agent-acp reports it (its authStatus extension, a
// push on `_auth/status_update`, claude-agent-acp 0.88): "none" is a Claude Code that is signed
// out, which its initialize and newSession don't say otherwise
export interface AuthStatus {
  kind: "account" | "api_key" | "gateway" | "external" | "none"
  label: string
}

const AUTH_STATUS_METHOD = "_auth/status_update"

export interface ProcessOptions {
  // Executable and its arguments, already resolved
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  // Variables read afresh before each start, over env (the system proxy, which may change while owlit runs)
  freshEnv?(): Promise<Record<string, string>>
  cwd: string
  // Ends the process after this long without a request or a running turn
  idleMs: number
  // The process ended without being asked to (crashed, was killed); the next call starts it again
  onCrash(ending: Ending): void
  onStart?(): void
  // Any end: idle, stopped, crashed
  onExit?(): void
  log?(line: string): void
  // What owlit tells this agent's adapter at initialize beyond ACP (clientCapabilities._meta)
  clientMeta?: Record<string, unknown>
  // A request of the adapter's own sent as soon as a session is opened (new or loaded), before anything
  // runs in it; one the adapter refuses is let go
  opened?(sessionId: string): { method: string; params: Record<string, unknown> } | undefined
}

const STDERR_KEPT = 20

// A call cut off because the agent's process ended under it: owlit stopped it (the app quitting, a sign-out)
// or it quit on its own, in which case `ending` says how (its exit code and last line on stderr)
export class AgentEnded extends Error {
  readonly stopped: boolean
  readonly ending?: Ending

  constructor(stopped: boolean, ending?: Ending) {
    const detail = ending && describeEnding(ending)
    super(stopped ? "The agent was stopped." : `The agent ${detail ?? "quit"}.`)
    this.stopped = stopped
    this.ending = ending
  }
}

// How a process ended on its own: killed by a signal, or exited with a code (and its last line on stderr)
export type Ending = { signal: string } | { code: number; last?: string }

// For logs and messages: "stopped (SIGKILL)", "exited with code 1: <its last line on stderr>"
const describeEnding = (ending: Ending) => ("signal" in ending ? `stopped (${ending.signal})` : `exited with code ${ending.code}${ending.last ? `: ${ending.last}` : ""}`)

// The same as the user reads it, with the agent's name: whole sentences, so each language orders them its
// own way. `again` adds that the next message starts it again.
// A select option's values, flattening groups
export const flatValues = (options: unknown) =>
  (options as ({ value: string } | { options: { value: string }[] })[]).flatMap((o) => ("options" in o ? o.options : [o])).map((o) => o.value)

// ACP's "auth_required" error
export const isAuthError = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code: number }).code === -32000

export function endingSentence(name: string, ending: Ending, again = false): string {
  if ("signal" in ending) {
    const signal = ending.signal
    return again ? t`${name} stopped (${signal}). It starts again with the next message.` : t`${name} stopped (${signal})`
  }
  const { code, last } = ending
  if (last) return again ? t`${name} exited with code ${code}: ${last}. It starts again with the next message.` : t`${name} exited with code ${code}: ${last}`
  return again ? t`${name} exited with code ${code}. It starts again with the next message.` : t`${name} exited with code ${code}`
}

// One child's life: whether it is being ended on purpose, and how it ended once it has
interface Life {
  stopping: boolean
  ended: Promise<Ending>
}

// One running local agent speaking ACP over stdio. Started by the first call that needs it, ended after
// idleMs without anything to do, started again by the next call after a crash. Many sessions (one per
// chat) share it.
export class AcpProcess {
  readonly options: ProcessOptions
  private child: ChildProcess | null = null
  private connection: acp.ClientSideConnection | null = null
  private started: Promise<acp.InitializeResponse> | null = null
  private handlers = new Map<string, SessionHandler>()
  // The session each agent's own session works for (child → parent), as the agent announced them
  private children = new Map<string, string>()
  private busy = 0
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  // Each child has its own
  private life: Life = { stopping: false, ended: new Promise(() => {}) }
  private stderr: string[] = []
  // What freshEnv said before the current (or next) process started
  private fresh: Record<string, string> = {}
  // The latest sign-in the agent reported, and who waits for the first report
  private auth: AuthStatus | undefined
  private authWaiters: ((status: AuthStatus | undefined) => void)[] = []

  constructor(options: ProcessOptions) {
    this.options = options
  }

  get running() {
    return this.child !== null
  }

  get pid() {
    return this.child?.pid
  }

  // What the agent said about itself when it started
  initialized(): Promise<acp.InitializeResponse> {
    return this.call(async () => this.started!)
  }

  // Whose sign-in the agent runs on, when it reports it; undefined when it doesn't (most agents), or
  // hasn't yet. The adapter reads it with a `claude auth status` run it starts at initialize and doesn't
  // wait for, so a check right after initialize waits up to `waitMs` for that first report, and only
  // from an agent that said it sends them (agentCapabilities._meta.authStatus).
  async authStatus(waitMs: number): Promise<AuthStatus | undefined> {
    if (this.auth) return this.auth
    const init = this.running ? await this.started?.catch(() => null) : null
    if (!init?.agentCapabilities?._meta?.authStatus) return undefined
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.authWaiters = this.authWaiters.filter((w) => w !== done)
        resolve(undefined)
      }, waitMs)
      const done = (status: AuthStatus | undefined) => {
        clearTimeout(timer)
        resolve(status)
      }
      this.authWaiters.push(done)
    })
  }

  newSession(params: acp.NewSessionRequest, handler: SessionHandler) {
    return this.call(async (c) => {
      const response = await c.newSession(params)
      this.handlers.set(response.sessionId, handler)
      await this.afterOpen(c, response.sessionId)
      return response
    })
  }

  // A sign-in the agent offers itself (the Owlit engine's ChatGPT and API keys); it may open a browser
  authenticate(params: acp.AuthenticateRequest) {
    return this.call((c) => c.authenticate(params))
  }

  logout(params: acp.LogoutRequest) {
    return this.call((c) => c.logout(params))
  }

  // A method of the agent's own (the Owlit engine's _owlit/…)
  extMethod(method: string, params: Record<string, unknown> = {}) {
    return this.call((c) => c.extMethod(method, params))
  }

  loadSession(params: acp.LoadSessionRequest, handler: SessionHandler) {
    return this.call(async (c) => {
      // Updates replaying the history arrive while the request runs, so the handler goes in first
      this.handlers.set(params.sessionId, handler)
      const response = await c.loadSession(params)
      await this.afterOpen(c, params.sessionId)
      return response
    })
  }

  private async afterOpen(connection: acp.ClientSideConnection, sessionId: string) {
    const request = this.options.opened?.(sessionId)
    if (request) await connection.extMethod(request.method, request.params).catch(() => undefined)
  }

  prompt(params: acp.PromptRequest) {
    return this.call((c) => c.prompt(params))
  }

  cancel(params: acp.CancelNotification) {
    return this.call((c) => c.cancel(params))
  }

  setMode(params: acp.SetSessionModeRequest) {
    return this.call((c) => c.setSessionMode(params))
  }

  setConfigOption(params: acp.SetSessionConfigOptionRequest) {
    return this.call((c) => c.setSessionConfigOption(params))
  }

  // Forgets a session on owlit's side; the agent closes it too when it can
  async closeSession(sessionId: string) {
    this.handlers.delete(sessionId)
    const init = this.running ? await this.started?.catch(() => null) : null
    if (init?.agentCapabilities?.sessionCapabilities?.close && this.connection) {
      await this.call((c) => c.closeSession({ sessionId })).catch(() => undefined)
    }
  }

  hasSession(sessionId: string) {
    return this.handlers.has(sessionId)
  }

  // Ends the process on purpose
  stop() {
    clearTimeout(this.idleTimer)
    if (!this.child) return
    this.life.stopping = true
    this.child.kill()
    this.reset()
    this.options.onExit?.()
  }

  // ---- inside ----

  // Runs one request against a started, initialized process, keeping it alive while it runs
  private async call<T>(work: (connection: acp.ClientSideConnection) => Promise<T>): Promise<T> {
    this.busy++
    clearTimeout(this.idleTimer)
    try {
      if (!this.started && this.options.freshEnv) this.fresh = await this.options.freshEnv()
      await this.start()
      const connection = this.connection!
      const life = this.life
      try {
        return await work(connection)
      } catch (error) {
        if (!connection.signal.aborted) throw error
        if (life.stopping) throw new AgentEnded(true)
        // The stream closes a moment before the process is seen to exit, and says nothing of why
        const ending = await Promise.race([life.ended, new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000).unref())])
        throw new AgentEnded(life.stopping, ending)
      }
    } finally {
      this.busy--
      this.scheduleIdle()
    }
  }

  private start() {
    if (this.started) return this.started
    const { file, args, cwd } = this.options
    const env = { ...this.options.env, ...this.fresh }
    let ended!: (ending: Ending) => void
    const life: Life = { stopping: false, ended: new Promise((resolve) => (ended = resolve)) }
    this.life = life
    this.stderr = []
    const child = spawn(file, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    this.options.onStart?.()
    child.stderr!.setEncoding("utf8")
    child.stderr!.on("data", (chunk: string) => {
      for (const line of chunk.split("\n").filter(Boolean)) {
        this.stderr.push(line)
        if (this.stderr.length > STDERR_KEPT) this.stderr.shift()
        this.options.log?.(line)
      }
    })

    const failedToStart = new Promise<never>((_, reject) => child.once("error", reject))
    child.once("exit", (code, signal) => {
      if (this.child === child) this.reset()
      // A process that exits on its own usually says why last; one killed by a signal says nothing useful
      const last = signal ? undefined : this.stderr.at(-1)
      // Node gives a code whenever there is no signal
      const ending: Ending = signal ? { signal } : { code: code ?? 0, ...(last ? { last } : {}) }
      ended(ending)
      if (life.stopping) return
      this.options.onCrash(ending)
      this.options.onExit?.()
    })

    this.connection = new acp.ClientSideConnection(
      () => ({
        sessionUpdate: async (n) => {
          const to = this.route(n.sessionId)
          to?.handler.update(n, to.agentId)
        },
        requestPermission: (r) => {
          const to = this.handlerFor(r.sessionId)
          return to.handler.requestPermission(r, to.agentId)
        },
        readTextFile: (r) => this.handlerFor(r.sessionId).handler.readTextFile(r),
        writeTextFile: (r) => this.handlerFor(r.sessionId).handler.writeTextFile(r),
        // A form not tied to a session (an MCP server's own) has nobody to show it to
        createElicitation: async (r) => {
          const sessionId = (r as { sessionId?: unknown }).sessionId
          if (typeof sessionId !== "string") return { action: "decline" }
          const to = this.handlerFor(sessionId)
          return to.handler.createElicitation(r, to.agentId)
        },
        extNotification: (method, params) => {
          if (method !== AUTH_STATUS_METHOD) return
          const status = (params as { authStatus?: AuthStatus }).authStatus
          if (!status || typeof status.kind !== "string") return
          this.auth = status
          for (const waiter of this.authWaiters.splice(0)) waiter(status)
        },
      }),
      acp.ndJsonStream(Writable.toWeb(child.stdin!), this.takeAgentNotices(Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>)),
    )
    const connection = this.connection
    // The connection can close before the process is seen to exit; the next call must not use it
    connection.signal.addEventListener("abort", () => {
      if (this.child === child) this.reset()
    })
    this.started = Promise.race([
      failedToStart,
      connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        // Forms: without them Claude Code turns its AskUserQuestion into a permission request, which
        // can only be allowed or rejected, never answered. Subagents: an agent's own agents then work in
        // sessions of their own, so their steps and questions say whose they are.
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          elicitation: { form: {} },
          subagents: {},
          // Claude Code lists its own sign-in only then; owlit runs it for the person, without a
          // terminal (Agents.signInOutside)
          auth: { terminal: true },
          ...(this.options.clientMeta ? { _meta: this.options.clientMeta } : {}),
        },
        clientInfo: { name: "owlit", version: "0.0.0" },
      }),
    ])
    this.started.catch(() => {
      life.stopping = true
      child.kill()
      if (this.child === child) this.reset()
    })
    return this.started
  }

  private handlerFor(sessionId: string) {
    const to = this.route(sessionId)
    if (!to) throw acp.RequestError.invalidParams(undefined, `owlit has no session ${sessionId}`)
    return to
  }

  // The handler a session's messages go to: its own, or, for an agent's own agent, the handler of the
  // session it works for, with the agent directly under that session as `agentId` (an agent of an agent
  // counts as the one that started it)
  private route(sessionId: string): { handler: SessionHandler; agentId?: string } | undefined {
    let id = sessionId
    let agentId: string | undefined
    for (let depth = 0; !this.handlers.has(id); depth++) {
      const parent = this.children.get(id)
      if (!parent || depth > 8) return undefined
      agentId = id
      id = parent
    }
    return { handler: this.handlers.get(id)!, agentId }
  }

  // Takes an agent's announcements of its own agents out of what it sends, before the SDK reads it.
  // Claude Code and Codex send them under names from before the draft settled ("subagent_spawned",
  // "subagent_state_update"; claude-agent-acp 0.88), which no SDK release knows:
  // the SDK would refuse each one as invalid and drop it. The draft's own "subagent_update" is taken the
  // same way.
  private takeAgentNotices(stream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let pending = ""
    return stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, out) => {
          pending += decoder.decode(chunk, { stream: true })
          let end: number
          let kept = ""
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end + 1)
            pending = pending.slice(end + 1)
            if (!this.agentNotice(line)) kept += line
          }
          if (kept) out.enqueue(encoder.encode(kept))
        },
        flush: (out) => {
          if (pending) out.enqueue(encoder.encode(pending))
        },
      }),
    )
  }

  // Whether the line was an announcement of an agent's own agent (and so is handled here)
  private agentNotice(line: string): boolean {
    if (!line.includes('"subagent_')) return false
    let message: { method?: unknown; params?: { sessionId?: unknown; update?: Record<string, unknown> } }
    try {
      message = JSON.parse(line)
    } catch {
      return false
    }
    const update = message.params?.update
    const kind = update?.sessionUpdate
    if (!update || message.method !== "session/update" || (kind !== "subagent_spawned" && kind !== "subagent_state_update" && kind !== "subagent_update")) return false
    const parent = message.params?.sessionId
    const child = update.subagentSessionId ?? update.sessionId
    if (typeof parent !== "string" || typeof child !== "string") return true
    const known = this.children.has(child)
    this.children.set(child, parent)
    const to = this.route(child)
    // Only the agents directly under a session are shown; an agent's own agents count as its work
    if (!to || to.agentId !== child) return true
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)
    // A later announcement may rename it (the draft's updates are patches)
    const title = text(update.name) ?? text(update.title) ?? text(update.description) ?? text(update.task)
    if (!known || title) to.handler.agent?.({ kind: "started", agentId: child, title: title ?? "An agent" })
    const state = typeof update.state === "string" ? update.state : (update.state as { state?: unknown } | null | undefined)?.state
    if (typeof state === "string") to.handler.agent?.({ kind: "state", agentId: child, state })
    return true
  }

  private reset() {
    this.child = null
    this.connection = null
    this.started = null
    this.handlers.clear()
    this.children.clear()
    // The next process reads its sign-in afresh; whoever waited on this one hears nothing
    this.auth = undefined
    for (const waiter of this.authWaiters.splice(0)) waiter(undefined)
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer)
    if (this.busy || !this.child) return
    this.idleTimer = setTimeout(() => this.stop(), this.options.idleMs)
  }
}
