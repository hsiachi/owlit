import type * as acp from "@agentclientprotocol/sdk"
import { RequestError } from "@agentclientprotocol/sdk"
import {
  applyUpdate,
  DEFAULT_ROLE,
  RpcErrorCode,
  type ChatMessage,
  type ConsentAction,
  type Mentionable,
  type PermissionKind,
  type PromptInput,
  type QuestionAnswer,
  type Role,
  type SessionUpdate,
  type StopReason,
  type ToolKind,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { realpathSync } from "node:fs"
import path from "node:path"
import type { Chats } from "../chats/chats.ts"
import type { Docs } from "../docs/docs.ts"
import { RpcFailure } from "../rpc/index.ts"
import type { Agents } from "./agents.ts"
import type { AgentFs } from "./fs.ts"
import type { AcpProcess, SessionHandler } from "./process.ts"
import { contentFrom, isSessionForm, questionsFrom, toolInfoOf } from "./questions.ts"
import { answerFor, consentFor, guardFor, roleNote, type Guard } from "./roles.ts"
import { preamble } from "./rules.ts"

export interface TurnRequest {
  chatId: string
  connectorId: string
  modelId?: string
  role?: Role
  effortId?: string
  input: PromptInput
  // The two messages the app already shows: what the user sent, and the answer about to stream in
  userMessage: ChatMessage
  assistantMessageId: string
}

interface TurnsOptions {
  agents: Agents
  fs: AgentFs
  workspace: () => { root: string; chats: Chats; docs: Docs } | null
  notify: (chatId: string, update: SessionUpdate) => void
  // The MCP servers a chat's session gets (owlit-mcp, for that chat)
  mcpServers?: (root: string, chatId: string) => acp.McpServer[]
  // What the user asked Owlit to call them, read when a session starts
  userName?: () => Promise<string | undefined>
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
  // Calls the agent announced to owlit's own MCP server: owlit-mcp decides consent for those itself
  owlitCalls: Set<string>
  // While a turn runs
  turn: Turn | null
}

interface Turn {
  chatId: string
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

  constructor(options: TurnsOptions) {
    this.options = options
  }

  async prompt(req: TurnRequest): Promise<StopReason> {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, "Open a folder as the workspace first.")
    if (this.turns.has(req.chatId)) throw new RpcFailure(RpcErrorCode.Conflict, "This chat is still answering.")

    const message: ChatMessage = {
      id: req.assistantMessageId,
      role: "assistant",
      createdAt: req.userMessage.createdAt + 1,
      parts: [],
      status: "streaming",
      connectorId: req.connectorId,
      modelId: req.modelId,
    }
    const turn: Turn = { chatId: req.chatId, role: req.role ?? DEFAULT_ROLE, heard: 0, message, permissions: new Map(), questions: new Map(), cancelled: false }
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
      this.options.notify(req.chatId, update)
      void ws.chats.patchMessage(req.chatId, turn.message).catch(() => undefined)
    }
    turn.emit = emit
    if (turn.role === "coauthor") this.coauthors.set(req.chatId, Infinity)
    const finish = async (status: ChatMessage["status"], error?: string) => {
      turn.message = { ...turn.message, status, ...(error ? { error } : {}) }
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
      const userName = fresh.created ? await this.options.userName?.() : undefined
      const prompt = promptBlocks(req.input, ws.root, fresh.history, fresh.created, userName)
      // The role goes before the user's words whenever it is new to this session
      if (live.told !== turn.role) prompt.splice(fresh.created ? 1 : 0, 0, { type: "text", text: roleNote(turn.role) })
      live.told = turn.role
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
      const text = isAuthError(error) ? await this.options.agents.signedOut(req.connectorId) : messageOf(error)
      await finish("error", text)
      throw new RpcFailure(RpcErrorCode.InternalError, text)
    } finally {
      this.closePermissions(turn, emit)
      if (live) live.turn = null
      // The watcher hears about the last writes a moment after the turn ends
      for (const claim of this.claims.values()) if (claim.chatId === req.chatId && claim.until === Infinity) claim.until = Date.now() + CLAIM_AFTER_MS
      if (this.coauthors.get(req.chatId) === Infinity) this.coauthors.set(req.chatId, Date.now() + CLAIM_AFTER_MS)
    }
  }

  async cancel(chatId: string) {
    const turn = this.turns.get(chatId)
    if (!turn) return null
    turn.cancelled = true
    // Questions still open are closed as cancelled, as ACP asks of a client that cancels
    for (const [, p] of turn.permissions) p.resolve({ outcome: { outcome: "cancelled" } })
    for (const [, answer] of turn.questions) answer("cancel")
    // A turn still starting has no session yet: it sees `cancelled` before it asks the agent
    for (const live of this.live.values()) {
      if (live.turn === turn) await live.proc.cancel({ sessionId: live.sessionId }).catch(() => undefined)
    }
    return null
  }

  respondPermission(chatId: string, requestId: string, optionId: string) {
    for (const live of this.live.values()) {
      const pending = live.turn?.chatId === chatId ? live.turn.permissions.get(requestId) : undefined
      if (!pending) continue
      pending.resolve({ outcome: { outcome: "selected", optionId } })
      return null
    }
    throw new RpcFailure(RpcErrorCode.NotFound, "That question is no longer waiting for an answer.")
  }

  answerQuestion(chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) {
    const answer = this.turns.get(chatId)?.questions.get(requestId)
    if (!answer) throw new RpcFailure(RpcErrorCode.NotFound, "That question is no longer waiting for an answer.")
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
    const guard = guardFor(req.connectorId, req.role ?? DEFAULT_ROLE, roots(ws.root))
    const meta = JSON.stringify(guard.meta ?? null)
    const known = this.live.get(key)
    if (known && known.proc === proc && proc.running && proc.hasSession(known.sessionId) && known.meta === meta) return { live: known, history: null, created: false, guard }

    const handler = this.handler(key, req.chatId, ws.root)
    const chat = await ws.chats.get(req.chatId)
    const recorded = chat.sessions?.[req.connectorId]
    const init = await proc.initialized()
    const _meta = guard.meta
    if (recorded && init.agentCapabilities?.loadSession) {
      try {
        loading.add(key)
        const loaded = await proc.loadSession({ sessionId: recorded, cwd: ws.root, mcpServers: this.mcpServers(ws.root, req.chatId), ...(_meta ? { _meta } : {}) }, handler)
        const live: Live = { sessionId: recorded, proc, options: loaded.configOptions ?? [], modes: loaded.modes ?? null, meta, told: known?.sessionId === recorded ? known.told : undefined, owlitCalls: new Set(), turn: null }
        this.live.set(key, live)
        return { live, history: null, created: false, guard }
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
    return { live, history: earlier.length ? transcript(earlier) : null, created: true, guard }
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
  // now (its emit), never to the one that opened the session
  private handler(key: string, chatId: string, root: string): SessionHandler {
    return {
      update: (n) => {
        // A loaded session replays its history first; the chat already has it
        if (loading.has(key)) return
        const live = this.live.get(key)
        if (n.update.sessionUpdate === "config_option_update" && live) live.options = n.update.configOptions
        if (n.update.sessionUpdate === "current_mode_update" && live?.modes) live.modes = { ...live.modes, currentModeId: n.update.currentModeId }
        if (!live?.turn) return
        if (n.update.sessionUpdate === "tool_call" && isOwlitCall(n.update)) live.owlitCalls.add(n.update.toolCallId)
        const update = toUpdate(n.update, root)
        if (!update) return
        live.turn.emit?.(update)
        this.claim(live.turn, update)
      },
      requestPermission: (r) => {
        const turn = this.live.get(key)?.turn
        const emit = turn?.emit
        if (!turn || !emit || turn.cancelled) return Promise.resolve({ outcome: { outcome: "cancelled" } })
        // A call to owlit's own tools asks owlit, not the user: owlit-mcp decides consent by the role
        // itself (Codex asks before every MCP call in its read-only mode)
        if (this.live.get(key)?.owlitCalls.has(r.toolCall.toolCallId)) {
          const allow = r.options.find((o) => o.kind === "allow_once")
          if (allow) return Promise.resolve({ outcome: { outcome: "selected", optionId: allow.optionId } })
        }
        // What the role doesn't allow is refused before the user sees it
        if (answerFor(turn.role, toKind(r.toolCall.kind)) === "reject") {
          const reject = r.options.find((o) => o.kind === "reject_once") ?? r.options.find((o) => o.kind === "reject_always")
          return Promise.resolve(reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } })
        }
        const requestId = randomUUID()
        const toolCallId = r.toolCall.toolCallId
        // A request may leave out what its tool call already announced (Codex sends only the id)
        const announced = turn.message.parts.find((p) => p.type === "tool_call" && p.toolCallId === toolCallId)
        const title = r.toolCall.title ?? (announced?.type === "tool_call" ? announced.title : undefined)
        // The tool call as the question describes it (its diff, above all), then the question. Announced
        // whole, since its own tool_call may not have arrived yet; a repeat merges into the first.
        emit({ type: "tool_call", toolCallId, title: title ?? "Tool", kind: toKind(r.toolCall.kind), status: "pending", ...toolContent(r.toolCall, root) })
        emit({
          type: "permission_request",
          requestId,
          toolCallId,
          title: title ?? "The agent asks to go ahead",
          kind: toKind(r.toolCall.kind),
          options: r.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind as PermissionKind })),
        })
        return new Promise((resolve) => {
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
      createElicitation: async (r) => {
        const turn = this.live.get(key)?.turn
        const emit = turn?.emit
        if (!turn || !emit || turn.cancelled) return { action: "cancel" }
        if (!isSessionForm(r)) return { action: "decline" }
        const questions = questionsFrom(r)
        if (!questions.length) return { action: "decline" }
        const requestId = randomUUID()
        const toolCallId = (r as { toolCallId?: string | null }).toolCallId ?? undefined
        emit({ type: "question_request", requestId, ...(toolCallId ? { toolCallId } : {}), questions })
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

  private closePermissions(turn: Turn, _emit: (u: SessionUpdate) => void) {
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

// A tool call to owlit's own MCP server: Codex says so in rawInput (and titles it mcp.owlit.<tool>),
// Claude Code titles it mcp__owlit__<tool>
function isOwlitCall(call: acp.ToolCall) {
  const input = call.rawInput as { server?: unknown } | undefined
  return input?.server === "owlit" || /^mcp(\.|__)owlit(\.|__)/.test(call.title ?? "")
}

// A select option's values, flattening groups
const flatValues = (options: unknown) =>
  (options as ({ value: string } | { options: { value: string }[] })[]).flatMap((o) => ("options" in o ? o.options : [o])).map((o) => o.value)

// Sessions being loaded, whose replayed history is not news
const loading = new Set<string>()

// ---- From owlit to ACP ----

// What the user sent, as content blocks: the text (mentions as their names), each mentioned or on-screen
// doc as a link to its file, papers and Knowledge by their owlit:// address, and a selected passage
// quoted. A session started over gets the conversation so far first.
export function promptBlocks(input: PromptInput, root: string, history: string | null, fresh = false, userName?: string): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = []
  // A new session hears owlit's rules first; a loaded one heard them when it began
  if (fresh) blocks.push({ type: "text", text: preamble(root, userName) })
  if (history) blocks.push({ type: "text", text: `The conversation so far, for context:\n\n${history}\n\n---\n` })
  blocks.push({ type: "text", text: input.text.replace(/@\[([^\]]+)\]/g, "$1") })
  if (input.selection) {
    const quoted = input.selection.text.split("\n").map((l) => `> ${l}`).join("\n")
    const { source, page, notePath } = input.selection
    const where = notePath
      ? `in their own note on ${source.title} (the file ${notePath}; it is the user's, so change it only when asked, by editing that file)`
      : `in ${source.title}${page ? `, on page ${page}` : ""}`
    blocks.push({ type: "text", text: `The user selected this passage ${where}:\n${quoted}` })
  }
  const seen = new Set<string>()
  for (const m of [...input.mentions, ...(input.context ?? []), ...(input.selection ? [input.selection.source] : [])]) {
    if (seen.has(m.uri)) continue
    seen.add(m.uri)
    blocks.push(linkOf(m, root))
  }
  for (const a of input.attachments) blocks.push({ type: "text", text: `(The user attached ${a.name}, which owlit can't pass on yet.)` })
  return blocks
}

function linkOf(m: Mentionable, root: string): acp.ContentBlock {
  const doc = /^owlit:\/\/docs\/(.+)$/.exec(m.uri)
  if (doc) {
    const rel = doc[1].split("/").map(decodeURIComponent).join("/")
    return { type: "resource_link", uri: `file://${path.join(root, rel)}`, name: m.title, title: m.title }
  }
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

function toolContent(call: { content?: acp.ToolCallContent[] | null; locations?: acp.ToolCallLocation[] | null }, root: string) {
  const out: { content?: string; locations?: { path: string; line?: number }[]; diff?: { path: string; oldText: string; newText: string } } = {}
  const text = (call.content ?? [])
    .map((c) => (c.type === "content" && c.content.type === "text" ? c.content.text : ""))
    .filter(Boolean)
    .join("\n")
  if (text) out.content = text
  const diff = (call.content ?? []).find((c) => c.type === "diff")
  if (diff && diff.type === "diff") out.diff = { path: relative(diff.path, root), oldText: diff.oldText ?? "", newText: diff.newText }
  if (call.locations?.length) out.locations = call.locations.map((l) => ({ path: relative(l.path, root), ...(l.line != null ? { line: l.line } : {}) }))
  return out
}

export function toUpdate(u: acp.SessionUpdate, root: string): SessionUpdate | null {
  switch (u.sessionUpdate) {
    case "agent_message_chunk":
      return u.content.type === "text" ? { type: "agent_message_chunk", text: u.content.text } : null
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

// ACP's "auth_required"
const isAuthError = (error: unknown) => typeof error === "object" && error !== null && "code" in error && (error as { code: number }).code === -32000

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error)
