// A stand-in local agent for tests: speaks ACP over stdio like claude-agent-acp, without a model.
// Run with node (types are stripped). What it does depends on the prompt's text:
//   "permission"       asks to run something, then says what the user chose
//   "read <path>"      reads a file through owlit and says how long it is
//   "write <path> <t>" writes t into a file through owlit
//   "direct <path> <t>" writes t into the file itself, as Claude Code does, announcing an edit tool call
//   "slow"             streams for a few seconds (to be cancelled)
//   "crash"            exits mid-turn
//   anything else      answers "echo: <text> (model/mode/effort)", adding "with history" when owlit
//                      passed the conversation so far
// FAKE_ACP_AUTH=required makes every new session fail as not signed in.

import * as acp from "@agentclientprotocol/sdk"
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { Readable, Writable } from "node:stream"

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(new Error("cancelled"))
    })
  })

interface Session {
  cwd: string
  turn: AbortController | null
  config: Record<string, string>
  history: string[]
}

const config = (s: Session): acp.SessionConfigOption[] => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: s.config.mode, options: [{ value: "ask", name: "Ask" }, { value: "auto", name: "Auto", description: "No questions" }] },
  { id: "model", name: "Model", category: "model", type: "select", currentValue: s.config.model, options: [{ value: "small", name: "Small" }, { value: "large", name: "Large" }] },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: s.config.effort, options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
]

class FakeAgent implements acp.Agent {
  private sessions = new Map<string, Session>()
  private conn: acp.AgentSideConnection

  constructor(conn: acp.AgentSideConnection) {
    this.conn = conn
  }

  async initialize(): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} } },
      agentInfo: { name: "fake-acp", version: "1.2.3" },
      authMethods: process.env.FAKE_ACP_AUTH ? [{ id: "login", name: "Log in" }] : [],
    }
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (process.env.FAKE_ACP_AUTH === "required") throw acp.RequestError.authRequired()
    const sessionId = randomUUID()
    const session: Session = { cwd: params.cwd, turn: null, config: { mode: "ask", model: "small", effort: "low" }, history: [] }
    this.sessions.set(sessionId, session)
    return { sessionId, configOptions: config(session) }
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const session = this.sessions.get(params.sessionId)
    if (!session) throw acp.RequestError.resourceNotFound(params.sessionId)
    for (const text of session.history) {
      await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } } })
    }
    return { configOptions: config(session) }
  }

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    this.sessions.delete(params.sessionId)
    return {}
  }

  async authenticate(): Promise<acp.AuthenticateResponse> {
    return {}
  }

  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    this.sessions.get(params.sessionId)!.config.mode = params.modeId
    return {}
  }

  async setSessionConfigOption(params: acp.SetSessionConfigOptionRequest): Promise<acp.SetSessionConfigOptionResponse> {
    const session = this.sessions.get(params.sessionId)!
    session.config[params.configId] = String(params.value)
    return { configOptions: config(session) }
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const session = this.sessions.get(params.sessionId)
    if (!session) throw acp.RequestError.resourceNotFound(params.sessionId)
    // The conversation so far, when owlit starts a session over, is context, not the request
    const history = params.prompt.some((b) => b.type === "text" && b.text.startsWith("The conversation so far"))
    // owlit's rules, before a new session's first prompt
    const rules = params.prompt.some((b) => b.type === "text" && b.text.startsWith("[owlit]"))
    const text = params.prompt
      .filter((b) => !(b.type === "text" && (b.text.startsWith("The conversation so far") || b.text.startsWith("[owlit]"))))
      .map((b) => (b.type === "text" ? b.text : b.type === "resource_link" ? `[${b.uri}]` : `[${b.type}]`))
      .join(" ")
    session.history.push(text)
    session.turn = new AbortController()
    const signal = session.turn.signal
    const say = (t: string) => this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } })
    try {
      if (text.includes("Write a reading note")) {
        const title = text.match(/starting with "# ([^"]+)"/)?.[1] ?? "Paper"
        await say("```markdown\n# " + title + "\n\n## Question\nWhat the fake paper asks, in a sentence long enough to count.\n\n## Method\nHow it goes about it.\n\n## Findings\nWhat it found (p. 1).\n\n## Limitations\nWhat it leaves open.\n\n## Why it matters\nWho would use it.\n```")
        return { stopReason: "end_turn" }
      }
      if (text.includes("rules?")) {
        await say(rules ? "got the rules" : "no rules this time")
        return { stopReason: "end_turn" }
      }
      if (text.includes("crash")) {
        await say("about to crash")
        process.exit(3)
      }
      if (text.includes("permission")) {
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run ls", kind: "execute", status: "pending" } })
        const answer = await this.conn.requestPermission({
          sessionId: params.sessionId,
          toolCall: { toolCallId: "t1", title: "Run ls", kind: "execute" },
          options: [
            { optionId: "yes", name: "Allow", kind: "allow_once" },
            { optionId: "no", name: "Reject", kind: "reject_once" },
          ],
        })
        const chose = answer.outcome.outcome === "selected" ? answer.outcome.optionId : "cancelled"
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: chose === "yes" ? "completed" : "failed" } })
        await say(`you chose ${chose}`)
        return { stopReason: chose === "cancelled" ? "cancelled" : "end_turn" }
      }
      const read = /read (\S+)/.exec(text)
      if (read) {
        try {
          const { content } = await this.conn.readTextFile({ sessionId: params.sessionId, path: `${session.cwd}/${read[1]}` })
          await say(`read ${content.length} characters`)
        } catch (error) {
          await say(`could not read: ${(error as Error).message}`)
        }
        return { stopReason: "end_turn" }
      }
      const direct = /direct (\S+) (.+)/.exec(text)
      if (direct) {
        const file = `${session.cwd}/${direct[1]}`
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "e1", title: `Edit ${direct[1]}`, kind: "edit", status: "in_progress", locations: [{ path: file }] } })
        writeFileSync(file, direct[2])
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "e1", status: "completed" } })
        await say("edited")
        return { stopReason: "end_turn" }
      }
      const write = /write (\S+) (.+)/.exec(text)
      if (write) {
        await this.conn.writeTextFile({ sessionId: params.sessionId, path: `${session.cwd}/${write[1]}`, content: write[2] })
        await say("written")
        return { stopReason: "end_turn" }
      }
      if (text.includes("slow")) {
        for (let i = 0; i < 50; i++) {
          await say(`${i} `)
          await sleep(100, signal)
        }
        return { stopReason: "end_turn" }
      }
      await say(`echo: ${text.slice(0, 40)}`)
      await sleep(20, signal)
      await say(` (${session.config.model}/${session.config.mode}/${session.config.effort})${history ? " with history" : ""}`)
      return { stopReason: "end_turn" }
    } catch (error) {
      if (signal.aborted) return { stopReason: "cancelled" }
      throw error
    } finally {
      session.turn = null
    }
  }

  async cancel(params: acp.CancelNotification) {
    this.sessions.get(params.sessionId)?.turn?.abort()
  }
}

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>)
new acp.AgentSideConnection((conn) => new FakeAgent(conn), stream)
