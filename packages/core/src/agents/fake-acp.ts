// A stand-in local agent for tests: speaks ACP over stdio like claude-agent-acp, without a model.
// Run with node (types are stripped). What it does depends on the prompt's text:
//   "permission"       asks to run something, then says what the user chose
//   "rewrite <path> <t>" asks to Write t (\n for a line break) over the whole file, as Claude Code does: the
//                      diff has no old text; allowed, it writes the file itself
//   "overwrite <path> <t>" Writes t over the whole file without asking, as Claude Code does in Co-author: the
//                      tool call's diff, with no old text, comes before the write and again after it
//   "read <path>"      reads a file through owlit and says how long it is
//   "write <path> <t>" writes t into a file through owlit
//   "direct <path> <t>" writes t into the file itself, as Claude Code does, announcing an edit tool call
//   "silent <path> <t>" writes t into the file itself without any tool call naming it, as a shell command does
//   "agents"           hands work to two agents of its own in sessions of their own, as ACP's subagent draft
//                      has it: one reads and reports what it found, the other asks to edit (on its own
//                      session) and reports what the user chose
//   "slow"             streams for a few seconds (to be cancelled)
//   "quiet"            says one word, then nothing until cancelled
//   "sleep through it" ends a finished turn on Claude Code's error line for a Mac that slept
//   "mute"             says nothing until cancelled; with FAKE_ACP_SESSION_GATE it first leaves
//                      <gate>.prompted, so a test knows the prompt arrived
//   "whole prompt…"    says back everything it was given (links as [uri], other blocks as [type])
//   "title"            says the title the session was given (codex-acp's _session/rename), or "untitled"
//   "crash"            exits mid-turn
//   "replied under your comment…" answers with comments_reply as the reply recipe says: "FAKE: correct"
//                      in the user's reply has it correct its comment, "FAKE: silent" leaves it unanswered
//   "call <method> <json>" calls owlit's core over the workspace's socket as owlit-mcp would, with the
//                      session owlit gave its owlit server, and says back the result
//   anything else      answers "echo: <text> (model/mode/effort)", adding "with history" when owlit
//                      passed the conversation so far
// FAKE_ACP_LIMIT="You've hit your session limit · resets 2:20am" fails every prompt as Claude Code does at
// its usage limit: the message as its answer, then an internal error carrying it.
// FAKE_ACP_HANG=session never answers a new session, as an agent stuck starting.
// FAKE_ACP_SESSION_GATE=<file> answers a new session only once that file exists, as a slow start.
// FAKE_ACP_AUTH=required makes every new session fail as not signed in. FAKE_ACP_AUTH=browser is signed out
// as claude-agent-acp is, offering its terminal sign-in, until that has run: "--login" leaves the file
// FAKE_ACP_SIGNED_IN behind and exits, as `claude auth login` does once the browser comes back; with
// FAKE_ACP_LOGIN_WAIT it first waits for that file to appear, as a person still in the browser.

import * as acp from "@agentclientprotocol/sdk"
import { createHash, randomUUID } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable, Writable } from "node:stream"

if (process.argv.includes("--login")) {
  const done = () => {
    writeFileSync(process.env.FAKE_ACP_SIGNED_IN!, "")
    process.exit(0)
  }
  const wait = process.env.FAKE_ACP_LOGIN_WAIT
  if (wait) setInterval(() => existsSync(wait) && done(), 20)
  else done()
}

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
  title?: string
  turn: AbortController | null
  config: Record<string, string>
  history: string[]
  // owlit's own tools, as owlit handed them to the session (its owlit-mcp server)
  owlit?: acp.McpServer
}

// One call to core over the workspace's socket, as owlit-mcp makes it (client/src/index.ts): the pointer
// file beside the socket names it and its token, and the session secret names the chat. A test passes
// the socket's folder as "--socket-dir" among the server's args.
async function callOwlit(server: acp.McpServer, method: string, params: unknown): Promise<unknown> {
  const args = "args" in server ? server.args : []
  const workspace = args[args.indexOf("--workspace") + 1]!
  const dir = args.includes("--socket-dir") ? args[args.indexOf("--socket-dir") + 1]! : tmpdir()
  const session = ("env" in server ? server.env : []).find((e) => e.name === "OWLIT_SESSION")?.value
  const hash = createHash("sha1").update(workspace.normalize("NFC")).digest("hex").slice(0, 12)
  const pointer = JSON.parse(readFileSync(path.join(dir, `owlit-${hash}.json`), "utf8")) as { socket: string; token: string }
  const socket = net.connect(pointer.socket)
  socket.setEncoding("utf8")
  const replies: ((message: { result?: unknown; error?: { message: string } }) => void)[] = []
  let buffer = ""
  socket.on("data", (chunk: string) => {
    buffer += chunk
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (line.trim()) replies.shift()?.(JSON.parse(line))
    }
  })
  let id = 0
  const send = (method: string, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      replies.push((m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)))
      socket.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n")
    })
  try {
    await send("auth", { token: pointer.token, ...(session ? { session } : {}) })
    return await send(method, params)
  } finally {
    socket.end()
  }
}

// FAKE_ACP_MODES="read-only,agent": the modes offered instead of ask and auto, starting in the last, as
// codex-acp offers its own and starts in whichever the user last chose
const MODES = process.env.FAKE_ACP_MODES?.split(",")

const config = (s: Session): acp.SessionConfigOption[] => [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: s.config.mode, options: MODES ? MODES.map((value) => ({ value, name: value })) : [{ value: "ask", name: "Ask" }, { value: "auto", name: "Auto", description: "No questions" }] },
  { id: "model", name: "Model", category: "model", type: "select", currentValue: s.config.model, options: [{ value: "small", name: "Small" }, { value: "large", name: "Large" }] },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: s.config.effort, options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
]

class FakeAgent implements acp.Agent {
  private sessions = new Map<string, Session>()
  private conn: acp.AgentSideConnection

  constructor(conn: acp.AgentSideConnection) {
    this.conn = conn
  }

  async initialize(params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    // FAKE_ACP_AUTH=none: as claude-agent-acp when Claude Code is signed out, which still opens sessions
    // and says so only in its authStatus push, a moment after initialize
    const browser = process.env.FAKE_ACP_AUTH === "browser"
    const reports = process.env.FAKE_ACP_AUTH === "none" || (browser && !existsSync(process.env.FAKE_ACP_SIGNED_IN!))
    if (reports) setTimeout(() => void this.conn.extNotification("_auth/status_update", { authStatus: { kind: "none", label: "Not logged in" } }), 50)
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { close: {} }, promptCapabilities: { image: true }, ...(reports ? { _meta: { authStatus: {} } } : {}) },
      agentInfo: { name: "fake-acp", version: "1.2.3" },
      authMethods: browser
        ? params.clientCapabilities?.auth?.terminal
          ? [{ id: "claude-ai-login", name: "Claude Subscription", type: "terminal", args: ["--login"] }]
          : []
        : process.env.FAKE_ACP_AUTH
          ? [{ id: "login", name: "Log in" }]
          : [],
      // The proxy it was started with, for the tests of proxy.ts
      // and what owlit told it beyond ACP, for the tests of process.ts
      _meta: { proxy: process.env.HTTPS_PROXY ?? null, client: params.clientCapabilities?._meta ?? null },
    }
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    if (process.env.FAKE_ACP_AUTH === "required") throw acp.RequestError.authRequired()
    if (process.env.FAKE_ACP_HANG === "session") await new Promise(() => {})
    const gate = process.env.FAKE_ACP_SESSION_GATE
    while (gate && !existsSync(gate)) await new Promise((resolve) => setTimeout(resolve, 20))
    const sessionId = randomUUID()
    const session: Session = { cwd: params.cwd, turn: null, config: { mode: MODES?.at(-1) ?? "ask", model: "small", effort: "low" }, history: [], owlit: params.mcpServers.find((m) => m.name === "owlit") }
    this.sessions.set(sessionId, session)
    return { sessionId, configOptions: config(session) }
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const session = this.sessions.get(params.sessionId)
    if (!session) throw acp.RequestError.resourceNotFound(params.sessionId)
    session.owlit = params.mcpServers.find((m) => m.name === "owlit") ?? session.owlit
    for (const text of session.history) {
      await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "user_message_chunk", content: { type: "text", text } } })
    }
    return { configOptions: config(session) }
  }

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    this.sessions.delete(params.sessionId)
    return {}
  }

  async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const session = this.sessions.get(String(params.sessionId))
    if (method !== "_session/rename" || !session) throw acp.RequestError.methodNotFound(method)
    session.title = String(params.title)
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
    const rules = params.prompt.some((b) => b.type === "text" && b.text.startsWith("[owlit] This session runs inside owlit"))
    // owlit's memory, when it is new to the session or changed
    const memory = params.prompt.find((b): b is acp.TextContent & { type: "text" } => b.type === "text" && /^\[owlit\] (What owlit keeps in mind|owlit's memory)/.test(b.text))
    const text = params.prompt
      .filter((b) => !(b.type === "text" && (b.text.startsWith("The conversation so far") || b.text.startsWith("[owlit]"))))
      .map((b) => (b.type === "text" ? b.text : b.type === "resource_link" ? `[${b.uri}]` : `[${b.type}]`))
      .join(" ")
    session.history.push(text)
    session.turn = new AbortController()
    const signal = session.turn.signal
    const say = (t: string) => this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } })
    try {
      if (process.env.FAKE_ACP_LIMIT) {
        await say(process.env.FAKE_ACP_LIMIT)
        throw acp.RequestError.internalError(undefined, process.env.FAKE_ACP_LIMIT)
      }
      if (text.includes("writing a literature note")) {
        // Writes back what it was given (the language, the pictures it saw), so tests can tell
        const id = text.match(/library_write_digest, id (\S+):/)?.[1] ?? "?"
        const language = text.match(/Language of the note:\n([^.]+)\./)?.[1] ?? "?"
        const pictures = params.prompt.filter((b) => b.type === "image").length
        const figure = text.match(/^- (figure-\d+) \(p\. \d+\)/m)?.[1]
        // Slow, with a step, for watching a digest being written in the app (FAKE_ACP_SLOW_MS)
        const slow = Number(process.env.FAKE_ACP_SLOW_MS) || 0
        if (slow) {
          await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "read1", title: "Read the paper's text", kind: "read", status: "in_progress" } })
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, slow)
            signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("cancelled"))), { once: true })
          })
          await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "read1", status: "completed" } })
        }
        const summary = `- **Background**: Written in ${language}, having seen ${pictures} pictures.\n- **Key Findings**: What it found (p. 1).` + (figure ? `\n\n![Figure](${figure})` : "")
        const details = "### What it measured\nHow it goes about it, in a sentence long enough to count.\n\n### The boundary of the conclusion\nWhat it leaves open."
        if (!session.owlit) {
          await say("I can't reach owlit's tools to write the digest.")
          return { stopReason: "end_turn" }
        }
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call", toolCallId: "digest1", title: "mcp__owlit__library_write_digest", kind: "other", status: "in_progress" } })
        await callOwlit(session.owlit, "library.writeDigest", { id, summary, details })
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "digest1", status: "completed" } })
        await say("The digest is written.")
        return { stopReason: "end_turn" }
      }
      if (text.includes("and the user has replied")) {
        if (!session.owlit) throw new Error("no owlit tools")
        const where = /comments_reply \(path "(.+?)", id "(.+?)"\)/.exec(text)!
        const latest = text.slice(text.lastIndexOf("The user: "))
        if (latest.includes("FAKE: silent")) {
          await say("Nothing to add.")
          return { stopReason: "end_turn" }
        }
        // As owlit-mcp's comments_reply does: one more entry under the comment
        const all = (await callOwlit(session.owlit, "comments.all", {})) as Record<string, { id: string; entries: unknown[] }[]>
        const comment = all[where[1]!]!.find((c) => c.id === where[2])!
        const answer = latest.includes("FAKE: correct") ? "CORRECT: The right words, after all." : `Answered, ${comment.entries.length} entries in.`
        await callOwlit(session.owlit, "comments.reply", { path: where[1], id: where[2], text: answer })
        await say("Replied.")
        return { stopReason: "end_turn" }
      }
      const call = /^call ([\w.]+) (\{.*\})$/s.exec(text)
      if (call) {
        if (!session.owlit) {
          await say("no owlit tools")
          return { stopReason: "end_turn" }
        }
        await say(`called: ${JSON.stringify(await callOwlit(session.owlit, call[1]!, JSON.parse(call[2]!)))}`)
        return { stopReason: "end_turn" }
      }
      if (text.includes("memory?")) {
        await say(memory ? memory.text : "no memory")
        return { stopReason: "end_turn" }
      }
      if (text.includes("rules?")) {
        const again = params.prompt.some((b) => b.type === "text" && b.text.startsWith("[owlit] owlit's rules changed"))
        await say(rules ? "got the rules" : again ? "got the new rules" : "no rules this time")
        return { stopReason: "end_turn" }
      }
      // As Claude Code ends a turn the Mac slept through: what it had, then its error line, as a finished turn
      if (text.includes("sleep through it")) {
        await say("The first half.")
        await say("API Error: Your computer went to sleep mid-response. The response above may be incomplete.")
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
        const report = (sessionId: string, text: string) => step(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text } })
        await notice({ sessionUpdate: "subagent_spawned", subagentSessionId: "agent-a", name: "Read the notes", task: "Read notes.md", capabilities: {} })
        await notice({ sessionUpdate: "subagent_spawned", subagentSessionId: "agent-b", name: "Fix the title", task: "Edit notes.md", capabilities: {} })
        await step("agent-a", { sessionUpdate: "tool_call", toolCallId: "a1", title: "Read notes.md", kind: "read", status: "completed", rawInput: { file_path: "notes.md" } })
        await report("agent-a", "The notes say twelve chars.")
        await notice({ sessionUpdate: "subagent_state_update", subagentSessionId: "agent-a", state: "completed" })
        await step("agent-b", { sessionUpdate: "tool_call", toolCallId: "b1", title: "Edit notes.md", kind: "edit", status: "pending", rawInput: { file_path: "notes.md" } })
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
        await report("agent-b", `The user chose ${chose}.`)
        await notice({ sessionUpdate: "subagent_state_update", subagentSessionId: "agent-b", state: "completed" })
        await say("both agents are done")
        return { stopReason: "end_turn" }
      }
      if (text.includes("with a helper")) {
        const notice = (update: Record<string, unknown>) => this.conn.sessionUpdate({ sessionId: params.sessionId, update } as unknown as acp.SessionNotification)
        const step = (sessionId: string, update: Record<string, unknown>) => this.conn.sessionUpdate({ sessionId, update } as unknown as acp.SessionNotification)
        await notice({ sessionUpdate: "subagent_spawned", subagentSessionId: "agent-h", name: "Read the story", task: "Read story.md", capabilities: {} })
        await step("agent-h", { sessionUpdate: "tool_call", toolCallId: "h1", title: "Read story.md", kind: "read", status: "completed", rawInput: { file_path: "story.md" } })
        await step("agent-h", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "The helper's notes." } })
        await notice({ sessionUpdate: "subagent_state_update", subagentSessionId: "agent-h", state: "completed" })
        await say("The answer.")
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
      const rewrite = /rewrite (\S+) (.+)/.exec(text)
      if (rewrite) {
        const file = `${session.cwd}/${rewrite[1]}`
        const content = rewrite[2].replace(/\\n/g, "\n")
        const answer = await this.conn.requestPermission({
          sessionId: params.sessionId,
          toolCall: {
            toolCallId: "w1",
            title: `Write ${rewrite[1]}`,
            kind: "edit",
            content: [{ type: "diff", path: file, oldText: null, newText: content }],
            rawInput: { file_path: file, content },
            _meta: { claudeCode: { toolName: "Write" } },
          },
          options: [
            { optionId: "yes", name: "Allow", kind: "allow_once" },
            { optionId: "no", name: "Reject", kind: "reject_once" },
          ],
        })
        const chose = answer.outcome.outcome === "selected" ? answer.outcome.optionId : "cancelled"
        // Allowed, it writes the file itself, as Claude Code does after the user's Apply
        if (chose === "yes") writeFileSync(file, content)
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "w1", status: chose === "yes" ? "completed" : "failed" } })
        await say(`you chose ${chose}`)
        return { stopReason: "end_turn" }
      }
      const overwrite = /overwrite (\S+) (.+)/.exec(text)
      if (overwrite) {
        const file = `${session.cwd}/${overwrite[1]}`
        const content = overwrite[2]
        const call = { toolCallId: "w2", content: [{ type: "diff" as const, path: file, oldText: null, newText: content }], rawInput: { file_path: file, content }, _meta: { claudeCode: { toolName: "Write" } } }
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call", title: `Write ${overwrite[1]}`, kind: "edit", status: "pending", ...call } })
        writeFileSync(file, content)
        await this.conn.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "tool_call_update", status: "completed", ...call } })
        await say("written")
        return { stopReason: "end_turn" }
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
      if (text.includes("mute")) {
        if (process.env.FAKE_ACP_SESSION_GATE) writeFileSync(`${process.env.FAKE_ACP_SESSION_GATE}.prompted`, "")
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()))
        return { stopReason: "cancelled" }
      }
      if (text.includes("quiet")) {
        await say("Hm.")
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()))
        return { stopReason: "cancelled" }
      }
      if (text.includes("slow")) {
        for (let i = 0; i < 50; i++) {
          await say(`${i} `)
          await sleep(100, signal)
        }
        return { stopReason: "end_turn" }
      }
      if (text === "mode?") {
        await say(session.config.mode)
        return { stopReason: "end_turn" }
      }
      if (text.startsWith("whole prompt")) {
        await say(text)
        return { stopReason: "end_turn" }
      }
      if (text === "title") {
        await say(session.title ?? "untitled")
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
