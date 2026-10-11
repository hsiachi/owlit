// Owlit engine (Beta): owlit's own agent, speaking ACP so owlit runs it like any installed agent. The
// loop is pi-agent-core's, the models pi-ai's; tools are the MCP servers owlit passes (owlit-mcp).

import * as acp from "@agentclientprotocol/sdk"
import type { CredentialStore, Models } from "@earendil-works/pi-ai"
import { randomUUID } from "node:crypto"
import { authMethods, availableModels, providerOf, signIn, signIns } from "./models.ts"
import { systemPrompt } from "./prompt.ts"
import { EngineSession } from "./session.ts"
import { DEFAULT_ROLE, fileTools, type Role } from "./files.ts"
import { connectTools, type Toolbox } from "./tools.ts"
import { AGENT_TOOL, agentTool, agentToolInfo } from "./agents.ts"

export const VERSION = "0.1.0-beta"

export class Engine implements acp.Agent {
  private readonly conn: acp.AgentSideConnection
  private readonly models: Models
  private readonly credentials: CredentialStore
  private readonly home: string
  private readonly log: (line: string) => void
  private sessions = new Map<string, EngineSession>()
  // Whether owlit serves file reads and writes; the file tools need both
  private files = false
  private turns = new Map<string, Promise<unknown>>()

  constructor(conn: acp.AgentSideConnection, models: Models, credentials: CredentialStore, home: string, log: (line: string) => void) {
    this.conn = conn
    this.models = models
    this.credentials = credentials
    this.home = home
    this.log = log
  }

  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    this.files = !!params.clientCapabilities?.fs?.readTextFile && !!params.clientCapabilities?.fs?.writeTextFile
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      // Images the user attaches come as pictures; the session passes them to a model that takes them
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} }, promptCapabilities: { image: true } },
      agentInfo: { name: "owlit-engine", title: "Owlit engine", version: VERSION },
      authMethods: authMethods(this.models),
      // owlit's rules, the role and the user's name go into the system prompt (prompt.ts), so owlit leaves
      // them out of the first prompt and passes the name in the session's _meta
      _meta: { owlit: { rulesInSystemPrompt: true } },
    }
  }

  async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
    try {
      await signIn(this.models, this.credentials, this.home, params.methodId, params._meta, AbortSignal.timeout(5 * 60_000))
    } catch (error) {
      this.log(`sign-in failed: ${messageOf(error)}`)
      throw asAcpError(error)
    }
    return {}
  }

  // One sign-in when _meta.owlit.methodId names it, otherwise all of them
  async logout(params: acp.LogoutRequest): Promise<acp.LogoutResponse> {
    const methodId = (params._meta as { owlit?: { methodId?: string } } | null | undefined)?.owlit?.methodId
    const providers = methodId ? [providerOf(methodId)] : (await this.credentials.list()).map((c) => c.providerId)
    for (const provider of providers) await this.models.logout(provider)
    return {}
  }

  // _owlit/sign_ins: what the engine is signed in to, for owlit's Settings
  async extMethod(method: string): Promise<Record<string, unknown>> {
    if (method === "_owlit/sign_ins") return { signIns: await signIns(this.models, this.credentials) }
    throw acp.RequestError.methodNotFound(method)
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const session = await this.open(randomUUID(), params.cwd, params.mcpServers, roleOf(params._meta), userNameOf(params._meta), undefined, backgroundOf(params._meta)).catch((error) => {
      throw asAcpError(error)
    })
    return { sessionId: session.id, configOptions: session.configOptions() }
  }

  // The transcript is read back, not replayed: owlit keeps the chat's messages itself
  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    await this.sessions.get(params.sessionId)?.close()
    const saved = await EngineSession.read(params.cwd, params.sessionId)
    if (!saved) throw acp.RequestError.resourceNotFound(params.sessionId)
    const session = await this.open(params.sessionId, params.cwd, params.mcpServers, roleOf(params._meta), userNameOf(params._meta), saved)
    return { configOptions: session.configOptions() }
  }

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    await this.sessions.get(params.sessionId)?.close()
    this.sessions.delete(params.sessionId)
    return {}
  }

  async setSessionConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.session(params.sessionId)
    session.setOption(params.configId, String(params.value))
    return { configOptions: session.configOptions() }
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.session(params.sessionId)
    const turn = session.prompt(params.prompt)
    this.turns.set(params.sessionId, turn)
    try {
      return { stopReason: await turn }
    } catch (error) {
      this.log(`turn failed: ${messageOf(error)}`)
      if (isAuthFailure(error)) throw acp.RequestError.authRequired()
      throw asAcpError(error)
    } finally {
      this.turns.delete(params.sessionId)
    }
  }

  async cancel(params: acp.CancelNotification) {
    this.sessions.get(params.sessionId)?.cancel()
  }

  private session(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw acp.RequestError.resourceNotFound(id)
    return session
  }

  // Without any sign-in there is no model to talk to: owlit shows that as "not signed in"
  // owlit's role for the chat decides which file tools the session has and whether they ask; a new role
  // comes as a new session (owlit loads it again with the role's _meta)
  // A background session (a reading note, a Knowledge run) has nobody to ask and no files to touch: it
  // gets only the owlit tools owlit names for it, and its answer is the result
  private async open(id: string, cwd: string, servers: acp.McpServer[], role: Role, userName: string | undefined, saved?: Awaited<ReturnType<typeof EngineSession.read>> & {}, background?: RegExp[]) {
    const available = await availableModels(this.models, this.credentials)
    if (!available.length) throw acp.RequestError.authRequired()
    const mcp = await connectTools(servers, cwd, this.log)
    const allowed = background ? mcp.tools.filter((t) => background.some((pattern) => pattern.test(t.name))) : mcp.tools
    const filesFor = (sessionId: string) => (this.files && !background ? fileTools({ conn: this.conn, sessionId, cwd, role }) : { tools: [], infos: new Map() })
    const files = filesFor(id)
    const context = { role, workspace: cwd, userName, rules: mcp.instructions, today: new Date().toISOString().slice(0, 10) }
    const prompt = systemPrompt({ ...context, background: !!background })
    // A chat's session can hand work to agents of its own (agents.ts); a background run and the agents
    // themselves can't. An agent's file tools are made for its own session, so owlit sees whose they are.
    let session: EngineSession | undefined
    const agents = background
      ? []
      : [
          agentTool({
            conn: this.conn,
            sessionId: id,
            models: this.models,
            current: () => session!.current(),
            systemPrompt: systemPrompt({ ...context, background: false, agent: true }),
            toolsFor: (agentSessionId) => {
              const own = filesFor(agentSessionId)
              return { tools: [...own.tools, ...allowed], info: (name) => own.infos.get(name) ?? mcp.info(name) }
            },
          }),
        ]
    const toolbox: Toolbox = {
      tools: [...files.tools, ...allowed, ...agents],
      info: (name) => (name === AGENT_TOOL ? agentToolInfo : (files.infos.get(name) ?? mcp.info(name))),
      close: mcp.close,
    }
    session = new EngineSession({
      id,
      cwd,
      systemPrompt: prompt,
      models: this.models,
      available,
      toolbox,
      saved,
      persist: !background,
      send: (update) => this.conn.sessionUpdate({ sessionId: id, update }),
    })
    this.sessions.set(id, session)
    return session
  }
}

const roleOf = (meta: Record<string, unknown> | null | undefined): Role => {
  const role = (meta as { owlit?: { role?: string } } | null | undefined)?.owlit?.role
  return role === "reviewer" || role === "assistant" || role === "coauthor" ? role : DEFAULT_ROLE
}

const userNameOf = (meta: Record<string, unknown> | null | undefined) => {
  const name = (meta as { owlit?: { userName?: unknown } } | null | undefined)?.owlit?.userName
  return typeof name === "string" && name.trim() ? name.trim() : undefined
}

// The tools a background session may use, as patterns over their names
const backgroundOf = (meta: Record<string, unknown> | null | undefined): RegExp[] | undefined => {
  const tools = (meta as { owlit?: { background?: { tools?: unknown } } } | null | undefined)?.owlit?.background?.tools
  return Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string").map((t) => new RegExp(t)) : undefined
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// The ACP SDK sends an error it doesn't know as a bare "Internal error"; owlit should show what happened
const asAcpError = (error: unknown) => (error instanceof acp.RequestError ? error : new acp.RequestError(-32603, messageOf(error)))

// A provider refusing the sign-in it was given (expired, revoked, wrong key)
function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(401|403)\b|unauthori[sz]ed|invalid api key|incorrect api key|authentication/i.test(message)
}
