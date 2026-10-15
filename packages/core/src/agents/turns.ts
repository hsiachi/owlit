import { t } from "@lingui/core/macro"
import type * as acp from "@agentclientprotocol/sdk"
import { RequestError } from "@agentclientprotocol/sdk"
import {
  applyUpdate,
  type AttachmentFile,
  DEFAULT_ROLE,
  type AgentStatus,
  HUNK_GAP,
  parseOwlitUri,
  RpcErrorCode,
  type ChatMessage,
  type ConsentAction,
  type MemoryLine,
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
import { type AcpProcess, AgentEnded, endingSentence, flatValues, isAuthError, type SessionHandler } from "./process.ts"
import { guardFor, handbackOf, isOwlitCall, ownTurnOver, PICTURE_MAX_BYTES, PICTURE_TYPES, sendsPictures } from "./profiles.ts"
import { contentFrom, isSessionForm, questionsFrom, toolInfoOf } from "./questions.ts"
import { answerFor, consentFor, roleNote, takesRules, withUserName } from "./roles.ts"
import type { Guard } from "./profiles.ts"
import { memoryNote, preamble, USER_FOLLOWS } from "./rules.ts"
import { messageOf } from "../util.ts"

export type TurnRequest = ParamsOf<"agents.prompt">

interface TurnsOptions {
  agents: Agents
  fs: AgentFs
  workspace: () => { root: string; chats: Chats; docs: Docs } | null
  // An update of the reply messageId, as it streams
  notify: (chatId: string, update: SessionUpdate, messageId: string) => void
  // A reply that had ended was opened again for what the agent sent after its turn, or it ended again
  lateReply?: (chatId: string, message: ChatMessage) => void
  // How long a reply opened again waits for more before it ends (tests shorten it)
  lateQuietMs?: number
  // The MCP servers a chat's session gets (owlit-mcp, for that chat)
  mcpServers?: (root: string, chatId: string) => acp.McpServer[]
  // What the user asked Owlit to call them, read when a session starts
  userName?: () => Promise<string | undefined>
  // Owlit's memory of the user, read before every prompt (memory.ts)
  memory?: () => Promise<MemoryLine[]>
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
  // What each of the agent's own agents said as text, and the ones that handed a report back
  agentText: Map<string, string>
  handedBack: Set<string>
  // Ends the reply with this status and saves it; set once the turn runs
  finish?: (status: ChatMessage["status"], error?: string, errorDetail?: string) => Promise<void>
  // Set while the reply is open again after its turn ended (see Turns.reopen)
  late?: Late
}

interface Late {
  // Ends the reply once nothing more has come for a while
  timer?: ReturnType<typeof setTimeout>
  // Tool calls the agent started or changed since: one still running keeps the reply open longer
  calls: Set<string>
  // Lets the agent's process idle out again
  release: () => void
  // Set once the reply is ending
  ending?: Promise<void>
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
  // Files a running (or just finished) turn's tool calls edit, move or delete: path → chat, and until when
  private claims = new Map<string, { chatId: string; until: number }>()
  // Chats whose Co-author turn is running (or just finished): chat → until when
  private coauthors = new Map<string, number>()
  // Each chat's last reply, while it is the last and its turn ended normally: what the agent sends on that
  // session with no turn running is added to it (see reopen)
  private ended = new Map<string, Turn>()

  constructor(options: TurnsOptions) {
    this.options = options
  }

  async prompt(req: TurnRequest): Promise<StopReason> {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, t`Open a folder as the workspace first.`)
    // A reply the agent took up again gives way to the user's next message: it ends here, and whatever the
    // agent still sends belongs to the new turn, which is the live one
    const running = this.turns.get(req.chatId)
    if (running?.late) await this.endLate(running, "done")
    if (this.turns.has(req.chatId)) throw new RpcFailure(RpcErrorCode.Conflict, t`This chat is still answering.`)
    this.ended.delete(req.chatId)

    const message: ChatMessage = {
      id: req.assistantMessageId,
      role: "assistant",
      createdAt: req.userMessage.createdAt + 1,
      parts: [],
      status: "streaming",
      connectorId: req.connectorId,
      modelId: req.modelId,
    }
    const turn: Turn = { chatId: req.chatId, key: `${req.chatId}/${req.connectorId}`, role: req.role ?? DEFAULT_ROLE, heard: 0, message, permissions: new Map(), questions: new Map(), cancelled: false, agentText: new Map(), handedBack: new Set() }
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
      if (turn.late) this.lateTick(turn, update)
    }
    turn.emit = emit
    if (turn.role === "coauthor") this.coauthors.set(req.chatId, Infinity)
    const finish = async (status: ChatMessage["status"], error?: string, errorDetail?: string) => {
      // An agent of the agent's that hadn't finished won't go on once the answer has ended
      for (const p of turn.message.parts) {
        if (p.type === "agent" && p.status === "working") emit({ type: "agent_update", agentId: p.agentId, status: status === "done" && p.report ? "done" : "stopped" })
      }
      turn.message = withoutAgentError({ ...turn.message, status, finishedAt: Date.now(), ...(error ? { error } : {}), ...(errorDetail ? { errorDetail } : {}) })
      await ws.chats.patchMessage(req.chatId, turn.message, true).catch(() => undefined)
    }
    turn.finish = finish

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
      // The agent may still go on (see reopen)
      if (stop !== "cancelled") this.ended.set(req.chatId, turn)
      return stop
    } catch (error) {
      if (turn.cancelled) {
        await finish("cancelled")
        return "cancelled"
      }
      // What the agent said as it failed decides between a sign-in and a refusal it can't fix by signing in
      const said = withoutAgentError({ ...turn.message, status: "error" }).errorDetail ?? ""
      const agents = this.options.agents
      if (error instanceof AgentEnded) {
        // The agent's process went away mid-turn; the library only says its connection closed
        const name = await agents.nameOf(req.connectorId)
        const text = error.stopped ? t`Owlit was closed before it could finish.` : t`${name} quit unexpectedly. It starts again with the next message.`
        const detail = error.ending ? endingSentence(name, error.ending) : undefined
        await finish("error", text, detail)
        throw new RpcFailure(RpcErrorCode.InternalError, text, detail ? { detail } : undefined)
      }
      const text = isAuthError(error)
        ? /\b403\b/.test(said)
          ? await agents.refused(req.connectorId)
          : await agents.signedOut(req.connectorId)
        : GENERIC.test(messageOf(error)) && said
          ? await agents.nameOf(req.connectorId).then((name) => t`${name} ran into a problem.`)
          : messageOf(error)
      await finish("error", text)
      throw new RpcFailure(RpcErrorCode.InternalError, text)
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
    // A reply taken up again has no prompt to come back cancelled: it ends here, and nothing the agent
    // sends after it is added
    if (turn.late) await this.endLate(turn, "cancelled")
    return null
  }

  respondPermission(chatId: string, requestId: string, optionId: string) {
    for (const live of this.live.values()) {
      const pending = live.turn?.chatId === chatId ? live.turn.permissions.get(requestId) : undefined
      if (!pending) continue
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
    this.coauthors.clear()
    this.ended.clear()
  }

  // The chat whose agent is changing this file, if one is (a change on disk is then the agent's). Besides
  // the files its tool calls name, a Co-author's turn owns any change in the workspace while it runs: its
  // shell commands write files no tool call names, and only a Co-author may (the other roles' agents
  // can't write the workspace from a shell). With two Co-authors at work nobody can tell whose it is.
  claimant(rel: string) {
    const claim = this.claims.get(rel)
    if (claim && claim.until >= Date.now()) return claim.chatId
    const coauthors = [...this.coauthors.entries()].filter(([, until]) => until >= Date.now())
    return coauthors.length === 1 ? coauthors[0][0] : undefined
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

    const handler = this.handler(key, req.chatId, req.connectorId, ws.root)
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
  // now (its emit), never to the one that opened the session. With no turn running it goes to the chat's
  // last reply, opened again (see reopen).
  private handler(key: string, chatId: string, connectorId: string, root: string): SessionHandler {
    const deliver = (make: (turn: Turn) => SessionUpdate[], over = false) => {
      const live = this.live.get(key)
      if (!live) return
      const running = this.running(key, chatId)
      if (running?.late) this.lateHeard(running, over)
      const turn = running ?? this.reopenable(key, chatId)
      if (!turn) return
      const updates = make(turn)
      if (!running && !this.reopen(live, turn, updates)) return
      for (const update of updates) {
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
          if (agentId) return this.agentWork(turn, agentId, n.update, root)
          const update = toUpdate(n.update, root)
          return update ? [update] : []
        }, !agentId && ownTurnOver(connectorId, n.update))
      },
      // One of the agent's own agents started or changed state
      agent: (notice) => {
        if (loading.has(key)) return
        const status = notice.kind === "state" ? agentStatus(notice.state) : undefined
        deliver(() =>
          notice.kind === "started"
            ? [{ type: "agent_started", agentId: notice.agentId, title: notice.title }]
            : status
              ? [{ type: "agent_update", agentId: notice.agentId, status }]
              : [],
        )
      },
      requestPermission: async (r, agentId) => {
        const turn = this.asking(key, chatId)
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
        emit({ type: "tool_call", toolCallId, title: title ?? t({ message: "Tool", comment: "a step in a chat whose tool the agent did not name" }), kind: toKind(toolCall.kind), status: "pending", ...toolContent(toolCall, root), ...by })
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
        const turn = this.asking(key, chatId)
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
        await asAcpError(this.options.fs.write(r.path, r.content, chatId))
        return {}
      },
    }
  }

  // What one of the agent's own agents sent: its steps, marked as its own, and its report. Its report is
  // the call it hands back with, or else what it said as text (an agent may tell its findings that way).
  private agentWork(turn: Turn, agentId: string, u: acp.SessionUpdate, root: string): SessionUpdate[] {
    const out: SessionUpdate[] = []
    if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
      const report = handbackOf(u)
      if (report) {
        turn.handedBack.add(agentId)
        out.push({ type: "agent_update", agentId, report })
      }
    }
    if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") {
      const text = (turn.agentText.get(agentId) ?? "") + u.content.text
      turn.agentText.set(agentId, text)
      if (!turn.handedBack.has(agentId)) out.push({ type: "agent_update", agentId, report: text })
      return out
    }
    const update = toUpdate(u, root)
    if (update?.type === "tool_call") out.push({ ...update, agentId })
    else if (update?.type === "tool_call_update") out.push(update)
    return out
  }

  // ---- A reply the agent takes up again ----
  //
  // An agent may go on after its turn has ended: Claude Code's prompt can come back end_turn while a
  // report from one of its background agents is still on its way, and the answer that report leads to
  // streams in a moment later with no prompt open (2026-10-11; profiles.ts, ownTurnOver). That belongs to
  // the reply it continues, so the chat's last reply is opened again: it streams, is saved and can be
  // stopped like a running turn, and ends again when the agent is done. Only a reply whose turn ended
  // normally, and that is still the chat's last, is opened again; a reply the user stopped stays stopped.
  //
  // When it ends: at the agent's own sign that its turn is over, where profiles.ts knows one, with no
  // question open and none of its agents at work; otherwise once LATE_QUIET_MS pass with nothing new. A
  // tool call or agent still running stretches that to LATE_STALLED_MS (a command can run silently for
  // minutes), and a question waits for the user as in any turn. Stop ends it at once and cancels the
  // session, and the user's next message ends it too (see prompt).

  // The turn that is running on this session, or starting on it (a new message whose session is still
  // being got ready: what the agent sends meanwhile is already the new turn's)
  private running(key: string, chatId: string): Turn | null {
    const live = this.live.get(key)
    if (live?.turn) return live.turn
    const starting = this.turns.get(chatId)
    return starting?.key === key && starting.emit ? starting : null
  }

  private reopenable(key: string, chatId: string): Turn | null {
    const turn = this.ended.get(chatId)
    return turn?.key === key && !this.turns.has(chatId) ? turn : null
  }

  // Where a permission request or a question goes: the running turn, or the last reply opened again
  private asking(key: string, chatId: string): Turn | null {
    const running = this.running(key, chatId)
    if (running) return running
    const live = this.live.get(key)
    const turn = this.reopenable(key, chatId)
    return live && turn && this.reopen(live, turn, null) ? turn : null
  }

  // Opens the reply again for what the agent sent, unless that changes nothing in it (the agent's own
  // bookkeeping, a step already finished). updates null: a question for the user, which always does.
  private reopen(live: Live, turn: Turn, updates: SessionUpdate[] | null) {
    if (updates && !updates.some((u) => changes(turn.message.parts, u))) return false
    this.ended.delete(turn.chatId)
    const { finishedAt: _finished, ...message } = turn.message
    turn.message = { ...message, status: "streaming" }
    turn.cancelled = false
    turn.late = { calls: new Set(), release: live.proc.hold() }
    live.turn = turn
    this.turns.set(turn.chatId, turn)
    if (turn.role === "coauthor") this.coauthors.set(turn.chatId, Infinity)
    if (process.env.OWLIT_LOG_AGENTS) console.log(`[turn ${turn.chatId.slice(0, 8)}] reply ${turn.message.id.slice(0, 8)} taken up again`)
    this.options.lateReply?.(turn.chatId, turn.message)
    this.lateTick(turn)
    return true
  }

  // Something came on the session of a reply open again; over: the agent's sign that its turn is over
  private lateHeard(turn: Turn, over: boolean) {
    if (over && !this.lateBusy(turn)) void this.endLate(turn, "done")
    else this.lateTick(turn)
  }

  // What keeps a reply open again from ending: a question waiting for the user, or work still running
  private lateBusy(turn: Turn): "asking" | "running" | null {
    if (turn.permissions.size || turn.questions.size) return "asking"
    const calls = turn.late?.calls
    const running = turn.message.parts.some(
      (p) => (p.type === "agent" && p.status === "working") || (p.type === "tool_call" && !!calls?.has(p.toolCallId) && (p.status === "pending" || p.status === "in_progress")),
    )
    return running ? "running" : null
  }

  // Starts the wait for the reply's end again
  private lateTick(turn: Turn, update?: SessionUpdate) {
    const late = turn.late
    if (!late || late.ending) return
    if (update?.type === "tool_call" || update?.type === "tool_call_update") late.calls.add(update.toolCallId)
    clearTimeout(late.timer)
    const wait = this.lateBusy(turn) === "running" ? LATE_STALLED_MS : (this.options.lateQuietMs ?? LATE_QUIET_MS)
    // A question the user hasn't answered yet keeps it open; the answer starts the wait again
    late.timer = setTimeout(() => this.lateBusy(turn) !== "asking" && void this.endLate(turn, "done"), wait)
  }

  private endLate(turn: Turn, status: "done" | "cancelled"): Promise<void> {
    const late = turn.late
    if (!late) return Promise.resolve()
    late.ending ??= (async () => {
      clearTimeout(late.timer)
      // Updates the SDK hasn't handed over yet are still the reply's
      if (status === "done") await quiet(turn)
      this.closePermissions(turn)
      await turn.finish?.(status)
      for (const live of this.live.values()) if (live.turn === turn) live.turn = null
      if (this.turns.get(turn.chatId) === turn) this.turns.delete(turn.chatId)
      turn.late = undefined
      late.release()
      this.letGo(turn.chatId)
      // It may be taken up again, as it was the first time
      if (status === "done") this.ended.set(turn.chatId, turn)
      if (process.env.OWLIT_LOG_AGENTS) console.log(`[turn ${turn.chatId.slice(0, 8)}] reply ${turn.message.id.slice(0, 8)} ended again (${status})`)
      this.options.lateReply?.(turn.chatId, turn.message)
    })()
    return late.ending
  }

  // A turn's hold on the files it changed ends a moment after the turn (the watcher hears about the last
  // writes a little later)
  private letGo(chatId: string) {
    for (const claim of this.claims.values()) if (claim.chatId === chatId && claim.until === Infinity) claim.until = Date.now() + CLAIM_AFTER_MS
    if (this.coauthors.get(chatId) === Infinity) this.coauthors.set(chatId, Date.now() + CLAIM_AFTER_MS)
  }

  // A tool call that edits, moves or deletes workspace files claims them for this chat while it runs
  private claim(turn: Turn, update: SessionUpdate) {
    if (update.type !== "tool_call" && update.type !== "tool_call_update") return
    const part = turn.message.parts.find((p) => p.type === "tool_call" && p.toolCallId === update.toolCallId)
    if (part?.type !== "tool_call" || !["edit", "delete", "move"].includes(part.kind)) return
    for (const p of [...(part.locations ?? []).map((l) => l.path), ...(part.diff ? [part.diff.path] : [])]) {
      if (!p.startsWith("/")) this.claims.set(p, { chatId: turn.chatId, until: Infinity })
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

const CLAIM_AFTER_MS = 5000

// How long a reply taken up again waits for more before it ends, for an agent with no sign of its own that
// its turn is over; within one turn Claude Code's longest silence was a couple of seconds (2026-10-11)
const LATE_QUIET_MS = 15_000
// The same while a tool call or one of its agents is still running, as long as the agent's process would
// stay up with nothing to do
const LATE_STALLED_MS = 10 * 60_000

// Whether an update would change a reply's parts (an update for a step it doesn't have, or that says what
// the step already says, doesn't)
function changes(parts: ChatMessage["parts"], u: SessionUpdate) {
  const next = applyUpdate(parts, u)
  return next.length !== parts.length || next.some((p, i) => p !== parts[i] && JSON.stringify(p) !== JSON.stringify(parts[i]))
}

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

// An agent's state, as owlit shows it: the adapters' words ("completed", "cancelled") and the draft's
// ("idle" once it has nothing left to do; "running" and "requires_action" while it is at it)
function agentStatus(state: string): AgentStatus | undefined {
  if (state === "completed" || state === "idle" || state === "done") return "done"
  if (state === "cancelled" || state === "interrupted") return "stopped"
  if (state === "failed" || state === "error") return "failed"
  if (state === "running" || state === "requires_action") return "working"
  return undefined
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
    const { source, page, notePath, inDigest } = input.selection
    const where = notePath
      ? `in their own note on ${source.title} (the file ${notePath}; it is the user's, so change it only when asked, by editing that file)`
      : inDigest
        ? `in Owlit's digest of ${source.title} (its digest.md, written from the full text; check the paper itself before taking a claim from it as the paper's)`
        : `in ${source.title}${page ? `, on page ${page}` : ""}`
    blocks.push({ type: "text", text: `The user selected this passage ${where}:\n${quoted}` })
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

// ---- From ACP to owlit ----

const KINDS = new Set<ToolKind>(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"])
const toKind = (kind?: string | null): ToolKind => (kind && KINDS.has(kind as ToolKind) ? (kind as ToolKind) : "other")

// Paths the agent reports, as the app shows them: relative to the workspace when inside it
const relative = (file: string, root: string) => {
  const rel = path.relative(root, file)
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file
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

function toolContent(call: { content?: acp.ToolCallContent[] | null; locations?: acp.ToolCallLocation[] | null }, root: string) {
  const out: { content?: string; locations?: { path: string; line?: number }[]; diff?: { path: string; oldText: string; newText: string } } = {}
  const text = (call.content ?? [])
    .map((c) => (c.type === "content" && c.content.type === "text" ? c.content.text : ""))
    .filter(Boolean)
    .join("\n")
  if (text) out.content = text
  // Claude Code reports a finished edit as one diff per changed part of the file; they are kept together,
  // a gap line between parts, so the step shows and counts the whole edit rather than its first part
  const diffs = (call.content ?? []).flatMap((c) => (c.type === "diff" ? [c] : []))
  const parts = diffs.filter((d) => d.path === diffs[0]?.path)
  if (parts.length)
    out.diff = {
      path: relative(parts[0].path, root),
      oldText: parts.map((d) => d.oldText ?? "").join(`\n${HUNK_GAP}\n`),
      newText: parts.map((d) => d.newText).join(`\n${HUNK_GAP}\n`),
    }
  if (call.locations?.length) out.locations = call.locations.map((l) => ({ path: relative(l.path, root), ...(l.line != null ? { line: l.line } : {}) }))
  return out
}

export function toUpdate(u: acp.SessionUpdate, root: string): SessionUpdate | null {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return u.content.type === "text" ? { type: "agent_message_chunk", text: u.content.text, ...(u.messageId ? { messageId: u.messageId } : {}) } : null
    case "agent_thought_chunk":
      return u.content.type === "text" ? { type: "agent_thought_chunk", text: u.content.text } : null
    case "tool_call": {
      const tool = toolInfoOf(u)
      return { type: "tool_call", toolCallId: u.toolCallId, title: u.title, kind: toKind(u.kind), status: u.status ?? "pending", ...toolContent(u, root), ...(tool ? { tool } : {}) }
    }
    case "tool_call_update": {
      // Claude Code sends the input again once it is complete; an update without it keeps what came first
      const tool = u.rawInput !== undefined ? toolInfoOf(u) : undefined
      return { type: "tool_call_update", toolCallId: u.toolCallId, ...(u.status ? { status: u.status } : {}), ...(u.title ? { title: u.title } : {}), ...toolContent(u, root), ...(tool ? { tool } : {}) }
    }
    case "plan":
      return { type: "plan", entries: u.entries.map((e) => ({ content: e.content, priority: e.priority, status: e.status })) }
    default:
      return null
  }
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

// An error that says nothing beyond that there was one: the agent's own words then explain it
const GENERIC = /^(internal error|error|unknown error)\.?$/i
