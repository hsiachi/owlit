import { t } from "@lingui/core/macro"
import type * as acp from "@agentclientprotocol/sdk"
import { RequestError } from "@agentclientprotocol/sdk"
import {
  applyUpdate,
  type AttachmentFile,
  DEFAULT_ROLE,
  parseOwlitUri,
  RpcErrorCode,
  type ChatMessage,
  type ConsentAction,
  type MemoryLine,
  type ReadFrom,
  type Mentionable,
  type ParamsOf,
  type PermissionKind,
  type PromptInput,
  type QuestionAnswer,
  type Role,
  type SessionUpdate,
  type StopReason,
  type ToolKind,
  withoutAgentError,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import path from "node:path"
import type { Chats } from "../chats/chats.ts"
import type { Docs } from "../docs/docs.ts"
import { RpcFailure } from "../rpc/index.ts"
import type { Agents } from "./agents.ts"
import type { AgentFs } from "./fs.ts"
import { failureOf } from "./failure.ts"
import { type AcpProcess, flatValues, type SessionHandler } from "./process.ts"
import { guardFor, isOwlitCall, PICTURE_MAX_BYTES, PICTURE_TYPES, sendsPictures } from "./profiles.ts"
import { contentFrom, isSessionForm, questionsFrom, toolInfoOf } from "./questions.ts"
import { answerFor, consentFor, roleNote, takesRules, withUserName } from "./roles.ts"
import type { Guard } from "./profiles.ts"
import { memoryNote, preamble, USER_FOLLOWS } from "./rules.ts"
import { agentNotice, agentWork, toKind, toolContent, toUpdate } from "./updates.ts"

export type TurnRequest = ParamsOf<"agents.prompt">

interface TurnsOptions {
  agents: Agents
  fs: AgentFs
  workspace: () => { root: string; chats: Chats; docs: Docs } | null
  // An update of the reply messageId, as it streams
  notify: (chatId: string, update: SessionUpdate, messageId: string) => void
  // The MCP servers a chat's session gets (owlit-mcp, for that chat)
  mcpServers?: (root: string, chatId: string) => acp.McpServer[]
  // What the user asked Owlit to call them, read when a session starts
  userName?: () => Promise<string | undefined>
  // Owlit's memory of the user, read before every prompt (memory.ts)
  memory?: () => Promise<MemoryLine[]>
  // What an answer was built from: the papers the chat's turn read since it started, and those its text cites
  readFrom?: (chatId: string, since: number, answer: string) => Promise<ReadFrom[]>
}

// A session of one chat on one agent, as owlit knows it
interface Live {
  sessionId: string
  proc: AcpProcess
  // What the agent offers and has set, by config id
  options: acp.SessionConfigOption[]
  modes: acp.SessionModeState | null
  // The session options the chat's role asked for (Guard.meta, as JSON) and the role the agent was told
  meta: string
  told?: Role
  // The memory as the agent last heard it (memoryNote), so it is told again only when it changed
  heard?: string
  // Calls the agent announced to owlit's own MCP server: owlit-mcp decides consent for those itself
  owlitCalls: Set<string>
  // While a turn runs
  turn: Turn | null
}

interface Turn {
  chatId: string
  // The chat's session it runs on: chat/connector, as Turns.live is keyed
  key: string
  role: Role
  // Updates taken so far; lets the end of a turn wait until no more are in flight
  heard: number
  message: ChatMessage
  permissions: Map<string, { toolCallId: string; resolve: (r: acp.RequestPermissionResponse) => void; options: acp.PermissionOption[] }>
  // Questions waiting for the user: answers by question id, null to skip, "cancel" when the turn stops
  questions: Map<string, (answers: Record<string, QuestionAnswer> | null | "cancel") => void>
  cancelled: boolean
  // Shows an update in the chat and saves it in the answer; set once the turn runs
  emit?: (update: SessionUpdate) => void
  // What each of the agent's own agents said as text: its report
  agentText: Map<string, string>
}

// Chat turns on local agents. Each chat has one ACP session per agent, recorded in the chat so it can be
// loaded again after a restart. A turn appends the user's message and the answer to the chat, streams
// the agent's updates to the app as chat.update and into the saved answer, and ends with a stop reason.
export class Turns {
  private readonly options: TurnsOptions
  private live = new Map<string, Live>()
  // The turn each chat is running, from the moment it is asked for (starting an agent and loading its
  // session take a while, and a Stop or a second send can come meanwhile)
  private turns = new Map<string, Turn>()
  // Files tool calls edit, move or delete, by path: the latest call to name each, until a moment after it
  // completed (the watcher hears about its writes a little later)
  private claims = new Map<string, Claim>()
  // Tool calls whose permission the user answered with an allow
  private accepted = new Set<string>()
  // Chats whose Co-author turn runs, until when (a moment after it ends, as for claims): a change nobody
  // claimed meanwhile came while it worked
  private coauthoring = new Map<string, number>()

  constructor(options: TurnsOptions) {
    this.options = options
  }

  async prompt(req: TurnRequest): Promise<StopReason> {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, t`Open a folder as the workspace first.`)
    if (this.turns.has(req.chatId)) throw new RpcFailure(RpcErrorCode.Conflict, t`This chat is still answering.`)

    const message: ChatMessage = {
      id: req.assistantMessageId,
      role: "assistant",
      createdAt: req.userMessage.createdAt + 1,
      parts: [],
      status: "streaming",
      connectorId: req.connectorId,
      modelId: req.modelId,
    }
    const turn: Turn = { chatId: req.chatId, key: `${req.chatId}/${req.connectorId}`, role: req.role ?? DEFAULT_ROLE, heard: 0, message, permissions: new Map(), questions: new Map(), cancelled: false, agentText: new Map() }
    this.turns.set(req.chatId, turn)
    try {
      return await this.run(req, ws, turn)
    } finally {
      this.turns.delete(req.chatId)
    }
  }

  private async run(req: TurnRequest, ws: NonNullable<ReturnType<TurnsOptions["workspace"]>>, turn: Turn): Promise<StopReason> {
    await ws.chats.appendMessage(req.chatId, req.userMessage)
    await ws.chats.appendMessage(req.chatId, turn.message)
    const emit = (update: SessionUpdate) => {
      turn.heard++
      turn.message = { ...turn.message, parts: applyUpdate(turn.message.parts, update) }
      this.options.notify(req.chatId, update, turn.message.id)
      void ws.chats.patchMessage(req.chatId, turn.message).catch(() => undefined)
    }
    turn.emit = emit
    if (turn.role === "coauthor") this.coauthoring.set(req.chatId, Infinity)
    const finish = async (status: ChatMessage["status"], error?: string, errorDetail?: string) => {
      // An agent of the agent's that hadn't finished won't go on once the answer has ended
      for (const p of turn.message.parts) {
        if (p.type === "agent" && p.status === "working") emit({ type: "agent_update", agentId: p.agentId, status: status === "done" && p.report ? "done" : "stopped" })
      }
      const answer = turn.message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n")
      const readFrom = (await this.options.readFrom?.(req.chatId, turn.message.createdAt, answer).catch(() => undefined)) ?? []
      turn.message = withoutAgentError({
        ...turn.message,
        status,
        finishedAt: Date.now(),
        ...(error ? { error } : {}),
        ...(errorDetail ? { errorDetail } : {}),
        ...(readFrom.length ? { readFrom } : {}),
      })
      await ws.chats.patchMessage(req.chatId, turn.message, true).catch(() => undefined)
    }

    let live: Live | undefined
    const t0 = Date.now()
    const log = (what: string) => process.env.OWLIT_LOG_AGENTS && console.log(`[turn ${req.chatId.slice(0, 8)}] ${what} +${Date.now() - t0}ms`)
    try {
      const fresh = await this.session(req, ws)
      log(`session ${fresh.history === null ? "ready" : "new, with history"}`)
      live = fresh.live
      live.turn = turn
      await this.configure(live, req, fresh.guard)
      log("configured")
      // Stopped while the agent was starting: it isn't asked at all
      if (turn.cancelled) throw new Error("Stopped before the agent was asked.")
      // owlit's rules and the role: in a new session's first prompt, unless the agent takes them itself
      const preamble = fresh.created && !fresh.rulesInSystemPrompt
      const userName = preamble ? await this.options.userName?.() : undefined
      // The role goes before the user's words whenever it is new to this session
      const role = live.told !== turn.role && !fresh.rulesInSystemPrompt ? roleNote(turn.role) : undefined
      const pictures = sendsPictures(req.connectorId, await live.proc.initialized(), req.modelId)
      const attached = await attachmentBlocks(req.input.attachments, ws.root, pictures)
      // Owlit's memory: in full when the session hasn't heard it, again whenever it changed since
      const lines = (await this.options.memory?.().catch(() => [])) ?? []
      const heard = JSON.stringify(lines.map((l) => [l.id, l.kind, l.text]))
      const memory = live.heard !== heard && (lines.length || live.heard !== undefined) ? memoryNote(lines, live.heard !== undefined) : undefined
      const prompt = promptBlocks(req.input, ws.root, fresh.history, preamble, userName, role, attached, memory)
      live.told = turn.role
      live.heard = heard
      const response = await live.proc.prompt({ sessionId: live.sessionId, prompt })
      log(`answered (${response.stopReason})`)
      await quiet(turn)
      const stop: StopReason = turn.cancelled || response.stopReason === "cancelled" ? "cancelled" : response.stopReason === "refusal" ? "refusal" : "end_turn"
      await finish(stop === "cancelled" ? "cancelled" : "done")
      return stop
    } catch (error) {
      if (turn.cancelled) {
        await finish("cancelled")
        return "cancelled"
      }
      const said = withoutAgentError({ ...turn.message, status: "error" }).errorDetail ?? ""
      const { text, detail } = await failureOf(this.options.agents, req.connectorId, error, said)
      await finish("error", text, detail)
      throw new RpcFailure(RpcErrorCode.InternalError, text, detail ? { detail } : undefined)
    } finally {
      this.closePermissions(turn)
      if (live) live.turn = null
      this.letGo(req.chatId)
    }
  }

  async cancel(chatId: string) {
    const turn = this.turns.get(chatId)
    if (!turn) return null
    turn.cancelled = true
    // Questions still open are closed as cancelled, as ACP asks of a client that cancels
    this.closePermissions(turn)
    // A turn still starting has no session yet: it sees `cancelled` before it asks the agent
    for (const live of this.live.values()) {
      if (live.turn === turn) await live.proc.cancel({ sessionId: live.sessionId }).catch(() => undefined)
    }
    return null
  }

  // How many chats have a turn running or starting
  answering() {
    return this.turns.size
  }

  respondPermission(chatId: string, requestId: string, optionId: string) {
    for (const live of this.live.values()) {
      const pending = live.turn?.chatId === chatId ? live.turn.permissions.get(requestId) : undefined
      if (!pending) continue
      // What the agent writes for this call next is the user's choice (Apply): "Owlit, taken by you"
      const kind = pending.options.find((o) => o.optionId === optionId)?.kind
      if (kind === "allow_once" || kind === "allow_always") {
        this.accepted.add(pending.toolCallId)
        for (const claim of this.claims.values()) if (claim.toolCallId === pending.toolCallId) claim.accepted = true
      }
      pending.resolve({ outcome: { outcome: "selected", optionId } })
      return null
    }
    throw new RpcFailure(RpcErrorCode.NotFound, t`That question is no longer waiting for an answer.`)
  }

  answerQuestion(chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) {
    const answer = this.turns.get(chatId)?.questions.get(requestId)
    if (!answer) throw new RpcFailure(RpcErrorCode.NotFound, t`That question is no longer waiting for an answer.`)
    answer(answers)
    return null
  }

  // Forgets the sessions of a workspace that closed, stopping its turns first: nothing could answer their
  // questions or stop them once they are forgotten
  reset() {
    for (const chatId of [...this.turns.keys()]) void this.cancel(chatId)
    this.live.clear()
    this.claims.clear()
    this.accepted.clear()
    this.coauthoring.clear()
  }

  // The live claim on a file: the tool call of a chat's agent that is changing it, if one is
  claimOf(rel: string): Claim | undefined {
    const claim = this.claims.get(rel)
    return claim && claim.until >= Date.now() ? claim : undefined
  }

  // The chat whose Co-author turn is running (or just ended), when exactly one is: a change on disk nobody
  // claimed came while it worked (its shell commands write files no tool call names), which says when,
  // not who
  coauthorAtWork(): string | undefined {
    const at = [...this.coauthoring].filter(([, until]) => until >= Date.now())
    return at.length === 1 ? at[0]![0] : undefined
  }

  // The call to owlit's own tools a chat's agent is making now, when exactly one is running: the tool
  // call an owlit-mcp request is for, when the engine doesn't name it
  owlitCallOf(chatId: string): string | undefined {
    for (const live of this.live.values()) {
      const turn = live.turn
      if (turn?.chatId !== chatId) continue
      const running = turn.message.parts.filter((p) => p.type === "tool_call" && live.owlitCalls.has(p.toolCallId) && (p.status === "pending" || p.status === "in_progress"))
      return running.length === 1 && running[0]!.type === "tool_call" ? running[0]!.toolCallId : undefined
    }
    return undefined
  }

  // Whether the agent of a chat may do this through owlit's own tools, by the role of its running turn;
  // asked of the user in the chat when the role says so
  async consent(chatId: string, action: ConsentAction, title: string): Promise<{ allowed: boolean; reason?: string }> {
    const turn = this.turns.get(chatId)
    // Between turns (a tool call that outlived its turn) the chat's saved role decides, and nobody is
    // there to be asked
    const role = turn ? turn.role : ((await this.options.workspace()?.chats.get(chatId).catch(() => null))?.role ?? DEFAULT_ROLE)
    const rule = consentFor(role, action)
    if (rule === "allow") return { allowed: true }
    if (typeof rule === "object") return { allowed: false, reason: rule.refuse }
    if (!turn || turn.cancelled) return { allowed: false, reason: "This chat isn't answering any more, so the user couldn't be asked." }
    const allowed = await this.ask(turn, title, action === "add_paper" ? "other" : action)
    return allowed ? { allowed } : { allowed, reason: "The user said no." }
  }

  // ---- inside ----

  private mcpServers(root: string, chatId: string) {
    return this.options.mcpServers?.(root, chatId) ?? []
  }

  // The chat's session on this agent: still open in the running process, loaded again from what the chat
  // recorded, or new. A new session for a chat that already has messages gets the conversation so far.
  // One open with options from another role is loaded again with this role's.
  private async session(req: TurnRequest, ws: { root: string; chats: Chats; docs: Docs }) {
    const key = `${req.chatId}/${req.connectorId}`
    const proc = await this.options.agents.process(req.connectorId)
    // An agent that takes owlit's rules in its own system prompt (the Owlit engine) is told the user's name
    // with the session's options instead of in a first-prompt preamble
    const rulesInSystemPrompt = takesRules(await proc.initialized())
    const role = guardFor(req.connectorId, req.role ?? DEFAULT_ROLE, roots(ws.root))
    const guard = rulesInSystemPrompt ? withUserName(role, await this.options.userName?.()) : role
    const meta = JSON.stringify(guard.meta ?? null)
    const known = this.live.get(key)
    if (known && known.proc === proc && proc.running && proc.hasSession(known.sessionId) && known.meta === meta) return { live: known, history: null, created: false, guard, rulesInSystemPrompt }

    const handler = this.handler(key, req.chatId, ws.root)
    const chat = await ws.chats.get(req.chatId)
    const recorded = chat.sessions?.[req.connectorId]
    const init = await proc.initialized()
    const _meta = guard.meta
    if (recorded && init.agentCapabilities?.loadSession) {
      try {
        loading.add(key)
        const loaded = await proc.loadSession({ sessionId: recorded, cwd: ws.root, mcpServers: this.mcpServers(ws.root, req.chatId), ...(_meta ? { _meta } : {}) }, handler)
        const live: Live = { sessionId: recorded, proc, options: loaded.configOptions ?? [], modes: loaded.modes ?? null, meta, told: known?.sessionId === recorded ? known.told : undefined, heard: known?.sessionId === recorded ? known.heard : undefined, owlitCalls: new Set(), turn: null }
        this.live.set(key, live)
        return { live, history: null, created: false, guard, rulesInSystemPrompt }
      } catch {
        // The agent no longer has it; a new session takes the conversation as context instead
      } finally {
        loading.delete(key)
      }
    }
    const created = await proc.newSession({ cwd: ws.root, mcpServers: this.mcpServers(ws.root, req.chatId), ...(_meta ? { _meta } : {}) }, handler)
    const live: Live = { sessionId: created.sessionId, proc, options: created.configOptions ?? [], modes: created.modes ?? null, meta, owlitCalls: new Set(), turn: null }
    this.live.set(key, live)
    await ws.chats.update(req.chatId, { sessions: { ...chat.sessions, [req.connectorId]: created.sessionId } })
    // The messages before this turn (the user's new one is already appended, so it is left out)
    const earlier = chat.messages.filter((m) => m.id !== req.userMessage.id && m.id !== req.assistantMessageId)
    return { live, history: earlier.length ? transcript(earlier) : null, created: true, guard, rulesInSystemPrompt }
  }

  // Sets the model and effort the chat asks for and the mode its role needs, where they differ from what
  // the session has
  private async configure(live: Live, req: TurnRequest, guard: Guard) {
    const offered = live.options.find((o) => o.category === "mode" && o.type === "select")
    const modeIds = offered && offered.type === "select" ? flatValues(offered.options) : (live.modes?.availableModes.map((m) => m.id) ?? [])
    const want: [string, string | undefined][] = [
      ["model", req.modelId],
      ["mode", guard.modes.find((m) => modeIds.includes(m))],
      ["thought_level", req.effortId],
    ]
    for (const [category, value] of want) {
      if (!value) continue
      const option = live.options.find((o) => o.category === category && o.type === "select")
      if (option && option.type === "select") {
        if (option.currentValue === value) continue
        const result = await live.proc.setConfigOption({ sessionId: live.sessionId, configId: option.id, value })
        live.options = result.configOptions ?? live.options.map((o) => (o.id === option.id ? ({ ...o, currentValue: value } as acp.SessionConfigOption) : o))
      } else if (category === "mode" && live.modes && live.modes.currentModeId !== value && live.modes.availableModes.some((m) => m.id === value)) {
        await live.proc.setMode({ sessionId: live.sessionId, modeId: value })
        live.modes = { ...live.modes, currentModeId: value }
      }
    }
  }

  // The session's handler outlives the turn it was made in: what the agent sends goes to the turn running
  // now (its emit), never to the one that opened the session. A reply ends with its prompt: what the agent
  // sends with no turn running belongs to no reply and is dropped.
  private handler(key: string, chatId: string, root: string): SessionHandler {
    const deliver = (make: (turn: Turn) => SessionUpdate[]) => {
      const turn = this.live.has(key) ? this.running(key, chatId) : null
      if (!turn) return
      for (const update of make(turn)) {
        turn.emit?.(update)
        this.claim(turn, update)
      }
    }
    return {
      update: (n, agentId) => {
        // A loaded session replays its history first; the chat already has it
        if (loading.has(key)) return
        const live = this.live.get(key)
        if (!agentId && n.update.sessionUpdate === "config_option_update" && live) live.options = n.update.configOptions
        if (!agentId && n.update.sessionUpdate === "current_mode_update" && live?.modes) live.modes = { ...live.modes, currentModeId: n.update.currentModeId }
        if (n.update.sessionUpdate === "tool_call" && isOwlitCall(n.update)) live?.owlitCalls.add(n.update.toolCallId)
        deliver((turn) => {
          if (agentId) return agentWork(turn, agentId, n.update, root)
          const update = toUpdate(n.update, root)
          return update ? [update] : []
        })
      },
      // One of the agent's own agents started or changed state
      agent: (notice) => {
        if (loading.has(key)) return
        deliver(() => agentNotice(notice))
      },
      requestPermission: async (r, agentId) => {
        // With no turn running nobody is there to answer
        const turn = this.running(key, chatId)
        const emit = turn?.emit
        if (!turn || !emit || turn.cancelled) return { outcome: { outcome: "cancelled" } }
        // A call to owlit's own tools asks owlit, not the user: owlit-mcp decides consent by the role
        // itself (Codex asks before every MCP call in its read-only mode)
        if (this.live.get(key)?.owlitCalls.has(r.toolCall.toolCallId)) {
          const allow = r.options.find((o) => o.kind === "allow_once")
          if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } }
        }
        // What the role doesn't allow is refused before the user sees it
        if (answerFor(turn.role, toKind(r.toolCall.kind)) === "reject") {
          const reject = r.options.find((o) => o.kind === "reject_once") ?? r.options.find((o) => o.kind === "reject_always")
          return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } }
        }
        const toolCall = await withReplacedText(r.toolCall, root)
        if (turn.cancelled) return { outcome: { outcome: "cancelled" } }
        const requestId = randomUUID()
        const toolCallId = toolCall.toolCallId
        // A request may leave out what its tool call already announced (Codex sends only the id)
        const announced = turn.message.parts.find((p) => p.type === "tool_call" && p.toolCallId === toolCallId)
        const title = toolCall.title ?? (announced?.type === "tool_call" ? announced.title : undefined)
        // The tool call as the question describes it (its diff, above all), then the question. Announced
        // whole, since its own tool_call may not have arrived yet; a repeat merges into the first.
        const by = agentId ? { agentId } : {}
        const announce: SessionUpdate = { type: "tool_call", toolCallId, title: title ?? t({ message: "Tool", comment: "a step in a chat whose tool the agent did not name" }), kind: toKind(toolCall.kind), status: "pending", ...toolContent(toolCall, root), ...by }
        emit(announce)
        // Its file is claimed now, so an Apply marks the claim whatever order the agent's updates come in
        this.claim(turn, announce)
        emit({
          type: "permission_request",
          requestId,
          toolCallId,
          title: title ?? t`The agent asks to go ahead`,
          kind: toKind(toolCall.kind),
          options: r.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind as PermissionKind })),
          ...by,
        })
        return new Promise<acp.RequestPermissionResponse>((resolve) => {
          turn.permissions.set(requestId, {
            toolCallId,
            options: r.options,
            resolve: (response) => {
              turn.permissions.delete(requestId)
              const kind = response.outcome.outcome === "selected" ? (r.options.find((o) => o.optionId === (response.outcome as { optionId: string }).optionId)?.kind as PermissionKind) : "cancelled"
              emit({ type: "permission_resolved", requestId, outcome: kind ?? "cancelled" })
              resolve(response)
            },
          })
        })
      },
      // The agent's questions, shown in the chat until the user answers or skips them
      createElicitation: async (r, agentId) => {
        const turn = this.running(key, chatId)

        const emit = turn?.emit
        if (!turn || !emit || turn.cancelled) return { action: "cancel" }
        if (!isSessionForm(r)) return { action: "decline" }
        const questions = questionsFrom(r)
        if (!questions.length) return { action: "decline" }
        const requestId = randomUUID()
        const toolCallId = (r as { toolCallId?: string | null }).toolCallId ?? undefined
        emit({ type: "question_request", requestId, ...(toolCallId ? { toolCallId } : {}), questions, ...(agentId ? { agentId } : {}) })
        return new Promise<acp.CreateElicitationResponse>((resolve) => {
          turn.questions.set(requestId, (answers) => {
            turn.questions.delete(requestId)
            if (answers === "cancel") {
              emit({ type: "question_resolved", requestId, outcome: "cancelled" })
              return resolve({ action: "cancel" })
            }
            if (answers === null) {
              emit({ type: "question_resolved", requestId, outcome: "skipped" })
              return resolve({ action: "decline" })
            }
            emit({ type: "question_resolved", requestId, outcome: "answered", answers })
            resolve({ action: "accept", content: contentFrom(r, questions, answers) })
          })
        })
      },
      readTextFile: (r) => asAcpError(this.options.fs.read(r.path, r.line ?? undefined, r.limit ?? undefined)),
      writeTextFile: async (r) => {
        await asAcpError(this.options.fs.write(r.path, r.content, { chatId }))
        return {}
      },
    }
  }

  // The turn that is running on this session, or starting on it (a new message whose session is still
  // being got ready: what the agent sends meanwhile is already the new turn's)
  private running(key: string, chatId: string): Turn | null {
    const live = this.live.get(key)
    if (live?.turn) return live.turn
    const starting = this.turns.get(chatId)
    return starting?.key === key && starting.emit ? starting : null
  }

  // A turn's tool calls that never said they completed let go of their files a moment after the turn, and
  // a Co-author's turn stops being at work
  private letGo(chatId: string) {
    for (const claim of this.claims.values()) if (claim.chatId === chatId && claim.until === Infinity) claim.until = Date.now() + CLAIM_AFTER_MS
    if (this.coauthoring.get(chatId) === Infinity) this.coauthoring.set(chatId, Date.now() + CLAIM_AFTER_MS)
  }

  // A tool call that edits, moves or deletes workspace files claims them while it runs, and until a moment
  // after it completes
  private claim(turn: Turn, update: SessionUpdate) {
    if (update.type !== "tool_call" && update.type !== "tool_call_update") return
    const part = turn.message.parts.find((p) => p.type === "tool_call" && p.toolCallId === update.toolCallId)
    if (part?.type !== "tool_call" || !["edit", "delete", "move"].includes(part.kind)) return
    const until = part.status === "completed" || part.status === "failed" ? Date.now() + CLAIM_AFTER_MS : Infinity
    const toolCallId = part.toolCallId
    for (const claim of this.claims.values()) if (claim.toolCallId === toolCallId && claim.until === Infinity) claim.until = until
    for (const p of [...(part.locations ?? []).map((l) => l.path), ...(part.diff ? [part.diff.path] : [])]) {
      if (p.startsWith("/") || this.claims.get(p)?.toolCallId === toolCallId) continue
      this.claims.set(p, { chatId: turn.chatId, toolCallId, ...(this.accepted.has(toolCallId) ? { accepted: true } : {}), until })
    }
  }

  // A question of owlit's own (not the agent's) in the chat: a tool call with the permission card, Allow
  // or Don't allow, answered like any other
  private ask(turn: Turn, title: string, kind: ToolKind): Promise<boolean> {
    const emit = turn.emit
    if (!emit) return Promise.resolve(false)
    const toolCallId = `owlit-${randomUUID()}`
    const requestId = randomUUID()
    const options: acp.PermissionOption[] = [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "reject", name: "Don't allow", kind: "reject_once" },
    ]
    emit({ type: "tool_call", toolCallId, title, kind, status: "pending" })
    emit({ type: "permission_request", requestId, toolCallId, title, kind, options: options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind as PermissionKind })) })
    return new Promise((resolve) => {
      turn.permissions.set(requestId, {
        toolCallId,
        options,
        resolve: (response) => {
          turn.permissions.delete(requestId)
          const allowed = response.outcome.outcome === "selected" && response.outcome.optionId === "allow"
          emit({ type: "permission_resolved", requestId, outcome: response.outcome.outcome === "selected" ? (allowed ? "allow_once" : "reject_once") : "cancelled" })
          emit({ type: "tool_call_update", toolCallId, status: allowed ? "completed" : "failed" })
          resolve(allowed)
        },
      })
    })
  }

  private closePermissions(turn: Turn) {
    for (const [, p] of turn.permissions) p.resolve({ outcome: { outcome: "cancelled" } })
    for (const [, answer] of turn.questions) answer("cancel")
  }
}

// The SDK can settle a prompt before it has handed over the updates the agent sent just ahead of its
// answer. A turn ends once a few turns of the event loop bring nothing new.
async function quiet(turn: Turn) {
  for (let calm = 0, last = turn.heard; calm < 3; ) {
    await new Promise((resolve) => setImmediate(resolve))
    if (turn.heard === last) calm++
    else {
      calm = 0
      last = turn.heard
    }
  }
}

// A tool call's claim on the files it names, while it runs (until Infinity) and a moment after
export interface Claim {
  chatId: string
  toolCallId: string
  // The user allowed this call's edit (Apply)
  accepted?: boolean
  until: number
}

const CLAIM_AFTER_MS = 5000

// The workspace as the agent may see it: as given and as the disk resolves it (/tmp is /private/tmp)
function roots(root: string) {
  let real = root
  try {
    real = realpathSync(root)
  } catch {
    // Gone or unreadable: the path as given still names it
  }
  return [...new Set([root, real])]
}

// Sessions being loaded, whose replayed history is not news
const loading = new Set<string>()

// ---- From owlit to ACP ----

// What the user sent, as content blocks: the text (mentions as their names), each mentioned or on-screen
// doc as a link to its file, papers and threads by their owlit:// address, and a selected passage
// quoted. A session started over gets the conversation so far first.
// What the agent is told for one turn, in this order: owlit's rules (a new session), the role (when it is
// new to the session), owlit's memory (when it is new to the session or changed), the conversation so far
// (a session started over), then the user's own words after a line marking where they begin, and last the
// attached files (attachmentBlocks)
export function promptBlocks(
  input: PromptInput,
  root: string,
  history: string | null,
  fresh = false,
  userName?: string,
  role?: string,
  attached?: acp.ContentBlock[],
  memory?: string,
): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = []
  // A new session hears owlit's rules first; a loaded one heard them when it began
  if (fresh) blocks.push({ type: "text", text: preamble(root, userName) })
  if (role) blocks.push({ type: "text", text: role })
  if (memory) blocks.push({ type: "text", text: memory })
  if (history) blocks.push({ type: "text", text: `The conversation so far, for context:\n\n${history}\n\n---\n` })
  if (blocks.length) blocks.push({ type: "text", text: USER_FOLLOWS })
  blocks.push({ type: "text", text: input.text.replace(/@\[([^\]]+)\]/g, "$1") })
  if (input.selection) {
    const quoted = input.selection.text.split("\n").map((l) => `> ${l}`).join("\n")
    const { source, page, notePath, inDigest, comment } = input.selection
    const where = notePath
      ? `in their own note on ${source.title} (the file ${notePath}; it is the user's, so change it only when asked, by editing that file)`
      : inDigest
        ? `in Owlit's digest of ${source.title} (its digest.md, written from the full text; check the paper itself before taking a claim from it as the paper's)`
        : `in ${source.title}${page ? `, on page ${page}` : ""}`
    if (comment?.entries.length) {
      // The comment is beside the doc, not in it; the agent reads what was said there here
      const said = comment.entries.map((e) => `${e.who}: ${e.text.split("\n").join("\n  ")}`).join("\n")
      blocks.push({ type: "text", text: `The user is asking about a comment on this passage ${where}:\n${quoted}\n\nThe comment, beside the doc (not in its text):\n${said}` })
    } else blocks.push({ type: "text", text: `The user selected this passage ${where}:\n${quoted}` })
  }
  const seen = new Set<string>()
  for (const m of [...input.mentions, ...(input.context ?? []), ...(input.selection ? [input.selection.source] : [])]) {
    if (seen.has(m.uri)) continue
    seen.add(m.uri)
    blocks.push(linkOf(m, root))
  }
  blocks.push(...(attached ?? []))
  return blocks
}

// The files the user attached, as the agent gets them: a line saying where owlit keeps the copies (the
// same paths every agent can read, whatever it makes of a link), then a link to each copy, and an image
// also as a picture when `pictures` says the agent takes one (profiles.ts). A file attached before owlit
// kept copies only had its name, and a copy can have gone (deleted by hand); the agent is told so rather
// than left to look for it.
export async function attachmentBlocks(attachments: AttachmentFile[], root: string, pictures: boolean): Promise<acp.ContentBlock[]> {
  if (!attachments.length) return []
  const kept: { file: AttachmentFile; abs: string; size: number }[] = []
  const lost: string[] = []
  for (const file of attachments) {
    const abs = file.path ? path.join(root, ...file.path.split("/")) : null
    const info = abs ? await stat(abs).catch(() => null) : null
    if (abs && info?.isFile()) kept.push({ file, abs, size: info.size })
    else lost.push(file.name)
  }
  const blocks: acp.ContentBlock[] = []
  if (kept.length) {
    const lines = kept.map(({ file, abs }) => `- ${file.name}: ${abs}`)
    blocks.push({ type: "text", text: `The user attached ${kept.length === 1 ? "a file" : `${kept.length} files`}. owlit keeps a copy of each in the workspace; leave them unchanged:\n${lines.join("\n")}` })
  }
  for (const { file, abs, size } of kept) {
    blocks.push({ type: "resource_link", uri: pathToFileURL(abs).href, name: file.name, title: file.name, size, ...(file.mimeType ? { mimeType: file.mimeType } : {}) })
    if (pictures && PICTURE_TYPES.has(file.mimeType) && size <= PICTURE_MAX_BYTES) {
      const data = await readFile(abs).catch(() => null)
      if (data) blocks.push({ type: "image", data: data.toString("base64"), mimeType: file.mimeType, uri: pathToFileURL(abs).href })
    }
  }
  for (const name of lost) blocks.push({ type: "text", text: `(The user attached ${name}, but owlit no longer has a copy of it.)` })
  return blocks
}

function linkOf(m: Mentionable, root: string): acp.ContentBlock {
  const u = parseOwlitUri(m.uri)
  if (u?.kind === "doc") return { type: "resource_link", uri: `file://${path.join(root, u.path)}`, name: m.title, title: m.title }
  return { type: "resource_link", uri: m.uri, name: m.title, title: m.title, ...(m.subtitle ? { description: m.subtitle } : {}) }
}

function transcript(messages: ChatMessage[]) {
  return messages
    .map((m) => {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("")
        .trim()
      return text ? `${m.role === "user" ? "User" : "Assistant"}: ${text}` : ""
    })
    .filter(Boolean)
    .join("\n\n")
}

// Claude Code asks to Write a file with the new text alone: the request can't tell a new file from one it
// replaces, so its diff always reads as a creation. The text it would replace is read here, so the edit
// is shown (and drawn in the doc) as what it changes. Only a whole-file Write: its one diff carries the
// tool's whole input, where a part of another agent's edit without old text is an insertion.
async function withReplacedText(call: acp.ToolCallUpdate, root: string): Promise<acp.ToolCallUpdate> {
  const diffs = (call.content ?? []).filter((c) => c.type === "diff")
  const write = toolInfoOf(call)?.name === "Write" ? (call.rawInput as { content?: unknown } | undefined) : undefined
  const diff = diffs.length === 1 ? diffs[0] : undefined
  if (!diff || diff.oldText != null || typeof write?.content !== "string" || write.content !== diff.newText) return call
  const replaced = await readFile(path.resolve(root, diff.path), "utf8").catch(() => null)
  if (replaced === null) return call
  return { ...call, content: call.content!.map((c) => (c === diff ? { ...diff, oldText: replaced } : c)) }
}

// owlit's errors reach the agent with their sentence, not as a bare "Internal error"
async function asAcpError<T>(work: Promise<T>): Promise<T> {
  try {
    return await work
  } catch (error) {
    if (error instanceof RpcFailure) throw new RequestError(error.code, error.message, error.data)
    throw error
  }
}

