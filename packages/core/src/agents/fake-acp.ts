// A stand-in local agent for tests: speaks ACP over stdio like claude-agent-acp, without a model.
// Run with node (types are stripped). What it does depends on the prompt's text:
//   "permission"       asks to run something, then says what the user chose
//   "read <path>"      reads a file through owlit and says how long it is
//   "write <path> <t>" writes t into a file through owlit
//   "direct <path> <t>" writes t into the file itself, as Claude Code does, announcing an edit tool call
//   "silent <path> <t>" writes t into the file itself without any tool call naming it, as a shell command does
//   "agents"           hands work to two agents of its own in sessions of their own, as Claude Code does once
//                      owlit says it understands subagents: one reads and hands a report back, the other asks
//                      to edit (on its own session) and reports what the user chose
//   "after the turn"   as Claude Code after background agents: starts an agent, ends its turn, and only then
//                      hears the agent finish and gives the real answer, with no prompt open
//   "after the turn, slowly"  the same, but that answer streams for a few seconds (to be stopped)
//   "slow"             streams for a few seconds (to be cancelled)
//   "whole prompt…"    says back everything it was given (links as [uri], other blocks as [type])
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
    // FAKE_ACP_AUTH=none: as claude-agent-acp when Claude Code is signed out, which still opens sessions
    // and says so only in its authStatus push, a moment after initialize
    const reports = process.env.FAKE_ACP_AUTH === "none"
    if (reports) setTimeout(() => void this.conn.extNotification("_auth/status_update", { authStatus: { kind: "none", label: "Not logged in" } }), 50)
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} }, promptCapabilities: { image: true }, ...(reports ? { _meta: { authStatus: {} } } : {}) },
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
      if (text.includes("writing a literature note")) {
        // Says back what it was given (the language, the pictures it saw), so tests can tell
        const title = text.match(/starting with "# ([^"]+)"/)?.[1] ?? "Paper"
        const language = text.match(/Language of the note:\n([^.]+)\./)?.[1] ?? "?"
        const pictures = params.prompt.filter((b) => b.type === "image").length
        const figure = text.match(/^- (figure-\d+) \(p\. \d+\)/m)?.[1]
        await say(
          "```markdown\n# " +
            title +
            `\n\n## Summary\n\n- **Background**: Written in ${language}, having seen ${pictures} pictures.\n- **Key Findings**: What it found (p. 1).\n\n` +
            (figure ? `![Figure](${figure})\n\n` : "") +
            "## Details\n\n### What it measured\nHow it goes about it, in a sentence long enough to count.\n\n### The boundary of the conclusion\nWhat it leaves open.\n```",
        )
        return { stopReason: "end_turn" }
      }
      if (text.includes("rules?")) {
        await say(rules ? "got the rules" : "no rules this time")
        return { stopReason: "end_turn" }
      }
      // As Claude Code fails a turn the API refused: its error as answer text, then auth_required
      if (text.includes("refuse me")) {
        await say("Failed to authenticate. API Error: 403 Request not allowed")
        throw acp.RequestError.authRequired()
      }
      if (text.includes("crash")) {
        await say("about to crash")
        process.exit(3)
      }
      if (text.includes("question")) {
        // As claude-agent-acp sends AskUserQuestion: the tool call, then one form field per question with
        // a free-text companion
        const input = { questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "the first" }, { label: "B" }] }] }
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "q1", title: "Which one?", kind: "other", status: "pending", rawInput: input, _meta: { claudeCode: { toolName: "AskUserQuestion" } } } })
        const answer = await this.conn.createElicitation({
          mode: "form",
          sessionId: params.sessionId,
          toolCallId: "q1",
          message: "Which one?",
          requestedSchema: {
            type: "object",
            properties: {
              question_0: { type: "string", title: "Pick", oneOf: [{ const: "A", title: "A", description: "the first" }, { const: "B", title: "B" }] },
              question_0_custom: { type: "string", title: "Other", description: "Type your own answer" },
            },
          },
        })
        await say(`answer ${JSON.stringify(answer)}`)
        return { stopReason: answer.action === "cancel" ? "cancelled" : "end_turn" }
      }
      if (text.includes("agents")) {
        // The announcements go under the names the adapters use, which the SDK doesn't type yet
        const notice = (update: Record<string, unknown>) => this.conn.sessionUpdate({ sessionId: params.sessionId, update } as unknown as acp.SessionNotification)
        const step = (sessionId: string, update: Record<string, unknown>) => this.conn.sessionUpdate({ sessionId, update } as unknown as acp.SessionNotification)
        const meta = (toolName: string, parent: string) => ({ claudeCode: { toolName, parentToolUseId: parent } })
        await notice({ sessionUpdate: "subagent_spawned", subagentSessionId: "agent-a", name: "Read the notes", task: "Read notes.md", capabilities: {} })
        await notice({ sessionUpdate: "subagent_spawned", subagentSessionId: "agent-b", name: "Fix the title", task: "Edit notes.md", capabilities: {} })
        await step("agent-a", { sessionUpdate: "tool_call", toolCallId: "a1", title: "Read notes.md", kind: "read", status: "completed", rawInput: { file_path: "notes.md" }, _meta: meta("Read", "toolu_a") })
        await step("agent-a", { sessionUpdate: "tool_call", toolCallId: "a2", title: "SubagentHandback", kind: "other", status: "pending", rawInput: { message: "The notes say twelve chars." }, _meta: meta("SubagentHandback", "toolu_a") })
        await notice({ sessionUpdate: "subagent_state_update", subagentSessionId: "agent-a", state: "completed" })
        await step("agent-b", { sessionUpdate: "tool_call", toolCallId: "b1", title: "Edit notes.md", kind: "edit", status: "pending", rawInput: { file_path: "notes.md" }, _meta: meta("Edit", "toolu_b") })
        const answer = await this.conn.requestPermission({
          sessionId: "agent-b",
          toolCall: { toolCallId: "b1", title: "Edit notes.md", kind: "edit" },
          options: [
            { optionId: "yes", name: "Allow", kind: "allow_once" },
            { optionId: "no", name: "Reject", kind: "reject_once" },
          ],
        })
        const chose = answer.outcome.outcome === "selected" ? answer.outcome.optionId : "cancelled"
        await step("agent-b", { sessionUpdate: "tool_call_update", toolCallId: "b1", status: chose === "yes" ? "completed" : "failed" })
        await step("agent-b", { sessionUpdate: "tool_call", toolCallId: "b2", title: "SubagentHandback", kind: "other", status: "pending", rawInput: { message: `The user chose ${chose}.` }, _meta: meta("SubagentHandback", "toolu_b") })
        await notice({ sessionUpdate: "subagent_state_update", subagentSessionId: "agent-b", state: "completed" })
        await say("both agents are done")
        return { stopReason: "end_turn" }
      }
      if (text.includes("after the turn")) {
        const notice = (update: Record<string, unknown>) => this.conn.sessionUpdate({ sessionId: params.sessionId, update } as unknown as acp.SessionNotification)
        await notice({ sessionUpdate: "subagent_spawned", subagentSessionId: "agent-l", name: "Count the words", task: "wc -w notes.md", capabilities: {} })
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: "m1", content: { type: "text", text: "I'm waiting on the agent." } } })
        const slow = text.includes("slowly")
        // What comes after the turn can be stopped like a turn
        const after = new AbortController()
        setTimeout(async () => {
          session.turn = after
          try {
            await notice({ sessionUpdate: "subagent_state_update", subagentSessionId: "agent-l", state: "completed" })
            await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: "The file has " } } })
            for (let i = 0; i < (slow ? 50 : 1); i++) {
              await sleep(slow ? 100 : 20, after.signal)
              await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", messageId: "m2", content: { type: "text", text: slow ? `${i} ` : "two words." } } })
            }
          } catch {
            // Stopped
          } finally {
            if (session.turn === after) session.turn = null
          }
        }, 150)
        return { stopReason: "end_turn" }
      }
      if (text.includes("permission")) {
        await this.conn.sessionUpdate({
          sessionId: params.sessionId,
          update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Run ls", kind: "execute", status: "pending", rawInput: { command: "ls", description: "List the folder" }, _meta: { claudeCode: { toolName: "Bash" } } },
        })
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
      const silent = /silent (\S+) (.+)/.exec(text)
      if (silent) {
        writeFileSync(`${session.cwd}/${silent[1]}`, silent[2])
        await say("ran a command")
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
      if (text.startsWith("whole prompt")) {
        await say(text)
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
