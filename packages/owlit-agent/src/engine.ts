// Owlit engine (Beta): owlit's own agent, speaking ACP so owlit runs it like any installed agent. The
// loop is pi-agent-core's, the models pi-ai's; tools are the MCP servers owlit passes (owlit-mcp).

import * as acp from "@agentclientprotocol/sdk"
import type { CredentialStore, Models } from "@earendil-works/pi-ai"
import { randomUUID } from "node:crypto"
import { authMethods, availableModels, signIn } from "./models.ts"
import { EngineSession } from "./session.ts"
import { connectTools } from "./tools.ts"

export const VERSION = "0.1.0-beta"

export class Engine implements acp.Agent {
  private readonly conn: acp.AgentSideConnection
  private readonly models: Models
  private readonly credentials: CredentialStore
  private readonly log: (line: string) => void
  private sessions = new Map<string, EngineSession>()
  private turns = new Map<string, Promise<unknown>>()

  constructor(conn: acp.AgentSideConnection, models: Models, credentials: CredentialStore, log: (line: string) => void) {
    this.conn = conn
    this.models = models
    this.credentials = credentials
    this.log = log
  }

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
      agentInfo: { name: "owlit-engine", title: "Owlit engine", version: VERSION },
      authMethods: authMethods(this.models),
    }
  }

  async authenticate(params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
    await signIn(this.models, this.credentials, params.methodId, params._meta, AbortSignal.timeout(5 * 60_000))
    return {}
  }

  async logout(): Promise<acp.LogoutResponse> {
    for (const { providerId } of await this.credentials.list()) await this.models.logout(providerId)
    return {}
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const session = await this.open(randomUUID(), params.cwd, params.mcpServers)
    return { sessionId: session.id, configOptions: session.configOptions() }
  }

  // The transcript is read back, not replayed: owlit keeps the chat's messages itself
  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    await this.sessions.get(params.sessionId)?.close()
    const saved = await EngineSession.read(params.cwd, params.sessionId)
    if (!saved) throw acp.RequestError.resourceNotFound(params.sessionId)
    const session = await this.open(params.sessionId, params.cwd, params.mcpServers, saved)
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
      this.log(`turn failed: ${(error as Error).message}`)
      if (isAuthFailure(error)) throw acp.RequestError.authRequired()
      throw error
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
  private async open(id: string, cwd: string, servers: acp.McpServer[], saved?: Awaited<ReturnType<typeof EngineSession.read>> & {}) {
    const available = await availableModels(this.models)
    if (!available.length) throw acp.RequestError.authRequired()
    const toolbox = await connectTools(servers, cwd, this.log)
    const session = new EngineSession({
      id,
      cwd,
      models: this.models,
      available,
      toolbox,
      saved,
      send: (update) => this.conn.sessionUpdate({ sessionId: id, update }),
    })
    this.sessions.set(id, session)
    return session
  }
}

// A provider refusing the sign-in it was given (expired, revoked, wrong key)
function isAuthFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(401|403)\b|unauthori[sz]ed|invalid api key|incorrect api key|authentication/i.test(message)
}
