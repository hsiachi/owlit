import * as acp from "@agentclientprotocol/sdk"
import { spawn, type ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"

// What owlit does for one ACP session: hear its updates, answer its permission requests, serve its
// file reads and writes. Registered per session; the process routes each request by session id.
export interface SessionHandler {
  update(notification: acp.SessionNotification): void
  requestPermission(request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse>
  readTextFile(request: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse>
  writeTextFile(request: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse>
  // A form the agent asks the user to fill in (Claude Code's AskUserQuestion)
  createElicitation(request: acp.CreateElicitationRequest): Promise<acp.CreateElicitationResponse>
}

export interface ProcessOptions {
  // Executable and its arguments, already resolved
  file: string
  args: string[]
  env: NodeJS.ProcessEnv
  cwd: string
  // Ends the process after this long without a request or a running turn
  idleMs: number
  // The process ended without being asked to (crashed, was killed); the next call starts it again.
  // detail: "stopped (SIGKILL)", "exited with code 1: <its last line on stderr>"
  onCrash(detail: string): void
  onStart?(): void
  // Any end: idle, stopped, crashed
  onExit?(): void
  log?(line: string): void
}

const STDERR_KEPT = 20

// A call cut off because the agent's process ended under it: owlit stopped it (the app quitting, a sign-out)
// or it quit on its own, in which case `detail` says how ("exited with code 1: <its last line on stderr>")
export class AgentEnded extends Error {
  readonly stopped: boolean
  readonly detail?: string

  constructor(stopped: boolean, detail?: string) {
    super(stopped ? "The agent was stopped." : `The agent ${detail ?? "quit"}.`)
    this.stopped = stopped
    this.detail = detail
  }
}

// One child's life: whether it is being ended on purpose, and how it ended once it has
interface Life {
  stopping: boolean
  ended: Promise<string>
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
  private busy = 0
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  // Each child has its own
  private life: Life = { stopping: false, ended: new Promise(() => {}) }
  private stderr: string[] = []

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

  newSession(params: acp.NewSessionRequest, handler: SessionHandler) {
    return this.call(async (c) => {
      const response = await c.newSession(params)
      this.handlers.set(response.sessionId, handler)
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
      return c.loadSession(params)
    })
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
      await this.start()
      const connection = this.connection!
      const life = this.life
      try {
        return await work(connection)
      } catch (error) {
        if (!connection.signal.aborted) throw error
        if (life.stopping) throw new AgentEnded(true)
        // The stream closes a moment before the process is seen to exit, and says nothing of why
        const detail = await Promise.race([life.ended, new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000).unref())])
        throw new AgentEnded(life.stopping, detail)
      }
    } finally {
      this.busy--
      this.scheduleIdle()
    }
  }

  private start() {
    if (this.started) return this.started
    const { file, args, env, cwd } = this.options
    let ended!: (detail: string) => void
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
      const detail = signal ? `stopped (${signal})` : `exited with code ${code}${last ? `: ${last}` : ""}`
      ended(detail)
      if (life.stopping) return
      this.options.onCrash(detail)
      this.options.onExit?.()
    })

    this.connection = new acp.ClientSideConnection(
      () => ({
        sessionUpdate: async (n) => this.handlers.get(n.sessionId)?.update(n),
        requestPermission: (r) => this.handlerFor(r.sessionId).requestPermission(r),
        readTextFile: (r) => this.handlerFor(r.sessionId).readTextFile(r),
        writeTextFile: (r) => this.handlerFor(r.sessionId).writeTextFile(r),
        // A form not tied to a session (an MCP server's own) has nobody to show it to
        createElicitation: async (r) => {
          const sessionId = (r as { sessionId?: unknown }).sessionId
          return typeof sessionId === "string" ? this.handlerFor(sessionId).createElicitation(r) : { action: "decline" }
        },
      }),
      acp.ndJsonStream(Writable.toWeb(child.stdin!), Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>),
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
        // can only be allowed or rejected, never answered
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, elicitation: { form: {} } },
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
    const handler = this.handlers.get(sessionId)
    if (!handler) throw acp.RequestError.invalidParams(undefined, `owlit has no session ${sessionId}`)
    return handler
  }

  private reset() {
    this.child = null
    this.connection = null
    this.started = null
    this.handlers.clear()
  }

  private scheduleIdle() {
    clearTimeout(this.idleTimer)
    if (this.busy || !this.child) return
    this.idleTimer = setTimeout(() => this.stop(), this.options.idleMs)
  }
}
