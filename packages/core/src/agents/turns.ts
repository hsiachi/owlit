import type * as acp from "@agentclientprotocol/sdk"
import { RequestError } from "@agentclientprotocol/sdk"
import {
  applyUpdate,
  RpcErrorCode,
  type ChatMessage,
  type Mentionable,
  type PermissionKind,
  type PromptInput,
  type SessionUpdate,
  type StopReason,
  type ToolKind,
} from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { Chats } from "../chats/chats.ts"
import type { Docs } from "../docs/docs.ts"
import { RpcFailure } from "../rpc/index.ts"
import type { Agents } from "./agents.ts"
import type { AgentFs } from "./fs.ts"
import type { AcpProcess, SessionHandler } from "./process.ts"
import { preamble } from "./rules.ts"

export interface TurnRequest {
  chatId: string
  connectorId: string
  modelId?: string
  modeId?: string
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
}

// A session of one chat on one agent, as owlit knows it
interface Live {
  sessionId: string
  proc: AcpProcess
  // What the agent offers and has set, by config id
  options: acp.SessionConfigOption[]
  modes: acp.SessionModeState | null
  // While a turn runs
  turn: Turn | null
}

interface Turn {
  chatId: string
  // Updates taken so far; lets the end of a turn wait until no more are in flight
  heard: number
  message: ChatMessage
  permissions: Map<string, { toolCallId: string; resolve: (r: acp.RequestPermissionResponse) => void; options: acp.PermissionOption[] }>
  cancelled: boolean
}

// Chat turns on local agents. Each chat has one ACP session per agent, recorded in the chat so it can be
// loaded again after a restart. A turn appends the user's message and the answer to the chat, streams
// the agent's updates to the app as chat.update and into the saved answer, and ends with a stop reason.
export class Turns {
  private readonly options: TurnsOptions
  private live = new Map<string, Live>()
  // Files a running (or just finished) turn's tool calls edit, move or delete: path → chat, and until when
  private claims = new Map<string, { chatId: string; until: number }>()

  constructor(options: TurnsOptions) {
    this.options = options
  }

  async prompt(req: TurnRequest): Promise<StopReason> {
    const ws = this.options.workspace()
    if (!ws) throw new RpcFailure(RpcErrorCode.NoWorkspace, "Open a folder as the workspace first.")
    const key = `${req.chatId}/${req.connectorId}`
    if (this.live.get(key)?.turn) throw new RpcFailure(RpcErrorCode.Conflict, "This chat is still answering.")

    const message: ChatMessage = {
      id: req.assistantMessageId,
      role: "assistant",
      createdAt: req.userMessage.createdAt + 1,
      parts: [],
      status: "streaming",
      connectorId: req.connectorId,
      modelId: req.modelId,
    }
    await ws.chats.appendMessage(req.chatId, req.userMessage)
    await ws.chats.appendMessage(req.chatId, message)
    const turn: Turn = { chatId: req.chatId, heard: 0, message, permissions: new Map(), cancelled: false }
    const emit = (update: SessionUpdate) => {
      turn.heard++
      turn.message = { ...turn.message, parts: applyUpdate(turn.message.parts, update) }
      this.options.notify(req.chatId, update)
      void ws.chats.patchMessage(req.chatId, turn.message).catch(() => undefined)
    }
    const finish = async (status: ChatMessage["status"], error?: string) => {
      turn.message = { ...turn.message, status, ...(error ? { error } : {}) }
      await ws.chats.patchMessage(req.chatId, turn.message, true).catch(() => undefined)
    }

    let live: Live | undefined
    const t0 = Date.now()
    const log = (what: string) => process.env.OWLIT_LOG_AGENTS && console.log(`[turn ${req.chatId.slice(0, 8)}] ${what} +${Date.now() - t0}ms`)
    try {
      const fresh = await this.session(req, ws, emit)
      log(`session ${fresh.history === null ? "ready" : "new, with history"}`)
      live = fresh.live
      live.turn = turn
      await this.configure(live, req)
      log("configured")
      const prompt = promptBlocks(req.input, ws.root, fresh.history, fresh.created)
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
    }
  }

  async cancel(chatId: string) {
    for (const live of this.live.values()) {
      const turn = live.turn
      if (turn?.chatId !== chatId) continue
      turn.cancelled = true
      // Questions still open are closed as cancelled, as ACP asks of a client that cancels
      for (const [, p] of turn.permissions) p.resolve({ outcome: { outcome: "cancelled" } })
      await live.proc.cancel({ sessionId: live.sessionId }).catch(() => undefined)
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

  // Forgets the sessions of a workspace that closed
  reset() {
    this.live.clear()
    this.claims.clear()
  }

  // The chat whose agent is changing this file, if one is (a change on disk is then the agent's)
  claimant(rel: string) {
    const claim = this.claims.get(rel)
    return claim && claim.until >= Date.now() ? claim.chatId : undefined
  }

  // ---- inside ----

  private mcpServers(root: string, chatId: string) {
    return this.options.mcpServers?.(root, chatId) ?? []
  }

  // The chat's session on this agent: still open in the running process, loaded again from what the chat
  // recorded, or new. A new session for a chat that already has messages gets the conversation so far.
  private async session(req: TurnRequest, ws: { root: string; chats: Chats; docs: Docs }, emit: (u: SessionUpdate) => void) {
    const key = `${req.chatId}/${req.connectorId}`
    const proc = await this.options.agents.process(req.connectorId)
    const known = this.live.get(key)
    if (known && known.proc === proc && proc.running && proc.hasSession(known.sessionId)) return { live: known, history: null, created: false }

    const handler = this.handler(key, req.chatId, ws.root, emit)
    const chat = await ws.chats.get(req.chatId)
    const recorded = chat.sessions?.[req.connectorId]
    const init = await proc.initialized()
    if (recorded && init.agentCapabilities?.loadSession) {
      try {
        loading.add(key)
        const loaded = await proc.loadSession({ sessionId: recorded, cwd: ws.root, mcpServers: this.mcpServers(ws.root, req.chatId) }, handler)
        const live: Live = { sessionId: recorded, proc, options: loaded.configOptions ?? [], modes: loaded.modes ?? null, turn: null }
        this.live.set(key, live)
        return { live, history: null, created: false }
      } catch {
        // The agent no longer has it; a new session takes the conversation as context instead
      } finally {
        loading.delete(key)
      }
    }
    const created = await proc.newSession({ cwd: ws.root, mcpServers: this.mcpServers(ws.root, req.chatId) }, handler)
    const live: Live = { sessionId: created.sessionId, proc, options: created.configOptions ?? [], modes: created.modes ?? null, turn: null }
    this.live.set(key, live)
    await ws.chats.update(req.chatId, { sessions: { ...chat.sessions, [req.connectorId]: created.sessionId } })
    // The messages before this turn (the user's new one is already appended, so it is left out)
    const earlier = chat.messages.filter((m) => m.id !== req.userMessage.id && m.id !== req.assistantMessageId)
    return { live, history: earlier.length ? transcript(earlier) : null, created: true }
  }

  // Sets the model, mode and effort the chat asks for, where they differ from what the session has
  private async configure(live: Live, req: TurnRequest) {
    const want: [string, string | undefined][] = [
      ["model", req.modelId],
      ["mode", req.modeId],
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

  private handler(key: string, chatId: string, root: string, emit: (u: SessionUpdate) => void): SessionHandler {
    return {
      update: (n) => {
        // A loaded session replays its history first; the chat already has it
        if (loading.has(key)) return
        const live = this.live.get(key)
        if (n.update.sessionUpdate === "config_option_update" && live) live.options = n.update.configOptions
        if (n.update.sessionUpdate === "current_mode_update" && live?.modes) live.modes = { ...live.modes, currentModeId: n.update.currentModeId }
        if (!live?.turn) return
        const update = toUpdate(n.update, root)
        if (!update) return
        emit(update)
        this.claim(live.turn, update)
      },
      requestPermission: (r) => {
        const turn = this.live.get(key)?.turn
        if (!turn || turn.cancelled) return Promise.resolve({ outcome: { outcome: "cancelled" } })
        const requestId = randomUUID()
        const toolCallId = r.toolCall.toolCallId
        // The tool call as the question describes it (its diff, above all), then the question. Announced
        // whole, since its own tool_call may not have arrived yet; a repeat merges into the first.
        emit({ type: "tool_call", toolCallId, title: r.toolCall.title ?? "Tool", kind: toKind(r.toolCall.kind), status: "pending", ...toolContent(r.toolCall, root) })
        emit({
          type: "permission_request",
          requestId,
          toolCallId,
          title: r.toolCall.title ?? "The agent asks to go ahead",
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

  private closePermissions(turn: Turn, _emit: (u: SessionUpdate) => void) {
    for (const [, p] of turn.permissions) p.resolve({ outcome: { outcome: "cancelled" } })
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

// Sessions being loaded, whose replayed history is not news
const loading = new Set<string>()

// ---- From owlit to ACP ----

// What the user sent, as content blocks: the text (mentions as their names), each mentioned or on-screen
// doc as a link to its file, papers and Knowledge by their owlit:// address, and a selected passage
// quoted. A session started over gets the conversation so far first.
export function promptBlocks(input: PromptInput, root: string, history: string | null, fresh = false): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = []
  // A new session hears owlit's rules first; a loaded one heard them when it began
  if (fresh) blocks.push({ type: "text", text: preamble(root) })
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
    case "tool_call":
      return { type: "tool_call", toolCallId: u.toolCallId, title: u.title, kind: toKind(u.kind), status: u.status ?? "pending", ...toolContent(u, root) }
    case "tool_call_update":
      return { type: "tool_call_update", toolCallId: u.toolCallId, ...(u.status ? { status: u.status } : {}), ...(u.title ? { title: u.title } : {}), ...toolContent(u, root) }
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
