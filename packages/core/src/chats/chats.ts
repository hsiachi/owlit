import { RpcErrorCode, type Chat, type ChatMessage, type ChatSummary } from "@owlit/protocol"
import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"

// How often a streaming chat is written while its messages keep changing
const WRITE_EVERY_MS = 500

interface IndexFile {
  version: 1
  chats: ChatSummary[]
}

type ChatFile = Chat & { version: 1 }

const notFound = (id: string) => new RpcFailure(RpcErrorCode.NotFound, "That chat is not in the workspace.", { id })

// The workspace's chats in .owlit/chats/: <id>.json holds a chat whole (its fields and messages), so one
// file can be read on its own (Knowledge reads them); index.json lists them without messages, so the
// list opens without reading every chat, and is rebuilt from the chat files when missing. Chats being
// streamed are written at most every WRITE_EVERY_MS and once more when the turn ends.
export class Chats {
  private readonly dir: string
  private readonly trashDir: string
  private index: Map<string, ChatSummary> | undefined
  private bodies = new Map<string, Chat>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Writes, one at a time per workspace, so the index and a chat file never race
  private writing: Promise<unknown> = Promise.resolve()

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "chats")
    this.trashDir = path.join(owlitDir, "trash")
  }

  // Most recently updated first
  async list(): Promise<ChatSummary[]> {
    return [...(await this.loadIndex()).values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Chat> {
    const cached = this.bodies.get(id)
    if (cached) return cached
    const summary = (await this.loadIndex()).get(id)
    if (!summary) throw notFound(id)
    // Only a missing file is an empty chat. Anything else (a file that can't be read or parsed right
    // now) fails the call and isn't cached: the next message would otherwise be written over the chat.
    const stored = await readJson<ChatFile>(this.fileOf(id)).catch((error) => {
      throw new RpcFailure(RpcErrorCode.Unavailable, "owlit couldn't read that chat just now.", { id, reason: error instanceof Error ? error.message : String(error) })
    })
    // A turn that was streaming when owlit last stopped never finished
    const messages = (stored?.messages ?? []).map((m) => (m.status === "streaming" ? cutOff(m) : m))
    const chat: Chat = { ...summary, messages }
    this.bodies.set(id, chat)
    return chat
  }

  async create(summary: ChatSummary) {
    const index = await this.loadIndex()
    if (index.has(summary.id)) throw new RpcFailure(RpcErrorCode.Conflict, "A chat with that id already exists.", { id: summary.id })
    const chat: Chat = { ...summary, messages: [] }
    index.set(chat.id, summary)
    this.bodies.set(chat.id, chat)
    await this.write(chat.id, true)
    return summary
  }

  // Title, pin, the agent and its settings, or the time it was last used
  async update(id: string, patch: Partial<Omit<ChatSummary, "id" | "createdAt">>) {
    const chat = await this.get(id)
    const next = { ...chat, ...patch }
    this.bodies.set(id, next)
    ;(await this.loadIndex()).set(id, summaryOf(next))
    await this.write(id, true)
    return summaryOf(next)
  }

  // To .owlit/trash/, whole, so it can be put back by hand
  async delete(id: string) {
    const chat = await this.get(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    ;(await this.loadIndex()).delete(id)
    this.bodies.delete(id)
    await this.serial(async () => {
      await writeJsonAtomic(path.join(this.trashDir, `${Date.now()}-chat-${id}.json`), { version: 1, ...chat })
      await rm(this.fileOf(id), { force: true })
      await this.writeIndex()
    })
    return null
  }

  async appendMessage(id: string, message: ChatMessage) {
    const chat = await this.get(id)
    const next = { ...chat, updatedAt: Math.max(chat.updatedAt, message.createdAt), messages: [...chat.messages, clean(message)] }
    this.bodies.set(id, next)
    ;(await this.loadIndex()).set(id, summaryOf(next))
    await this.write(id, message.status !== "streaming")
    return null
  }

  // Replaces a message by id (a streamed answer as it grows); final writes it out at once
  async patchMessage(id: string, message: ChatMessage, final = false) {
    const chat = await this.get(id)
    if (!chat.messages.some((m) => m.id === message.id)) throw notFound(`${id}/${message.id}`)
    this.bodies.set(id, { ...chat, messages: chat.messages.map((m) => (m.id === message.id ? clean(message) : m)) })
    await this.write(id, final)
    return null
  }

  // Everything still waiting to be written
  async flush() {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer)
      this.timers.delete(id)
      await this.write(id, true)
    }
    await this.writing
  }

  // ---- inside ----

  private fileOf(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new RpcFailure(RpcErrorCode.InvalidParams, "That is not a chat id.", { id })
    return path.join(this.dir, `${id}.json`)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writing.then(work)
    this.writing = run.catch((error) => console.error("[core] couldn't write chats", error))
    return run
  }

  // Now, or within WRITE_EVERY_MS for a chat that keeps changing
  private write(id: string, now: boolean): Promise<void> {
    if (!now) {
      if (!this.timers.has(id)) {
        this.timers.set(
          id,
          setTimeout(() => {
            this.timers.delete(id)
            void this.write(id, true)
          }, WRITE_EVERY_MS),
        )
      }
      return Promise.resolve()
    }
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    return this.serial(async () => {
      const chat = this.bodies.get(id)
      if (!chat) return
      await writeJsonAtomic(this.fileOf(id), { version: 1, ...chat })
      await this.writeIndex()
    })
  }

  private async writeIndex() {
    const index = await this.loadIndex()
    const file: IndexFile = { version: 1, chats: [...index.values()].sort((a, b) => b.updatedAt - a.updatedAt) }
    await writeJsonAtomic(path.join(this.dir, "index.json"), file)
  }

  private async loadIndex() {
    if (this.index) return this.index
    let stored: IndexFile | undefined
    try {
      stored = await readJson<IndexFile>(path.join(this.dir, "index.json"))
    } catch (error) {
      console.error("[core] chats/index.json is unreadable; rebuilding it from the chat files", error)
    }
    const index = new Map((stored?.chats ?? []).map((c) => [c.id, c]))
    // Chat files the index doesn't know (it was lost, or written by an older build) are taken in
    const names = await readdir(this.dir).catch(() => [] as string[])
    for (const name of names) {
      const id = name.endsWith(".json") && name !== "index.json" ? name.slice(0, -5) : null
      if (!id || index.has(id)) continue
      const chat = await readJson<ChatFile>(path.join(this.dir, name)).catch(() => undefined)
      if (chat?.id === id) index.set(id, summaryOf(chat))
    }
    this.index = index
    if (!stored && index.size) await mkdir(this.dir, { recursive: true }).then(() => this.writeIndex())
    return index
  }
}

function summaryOf(chat: Chat | ChatFile): ChatSummary {
  const { id, title, createdAt, updatedAt, pinned, connectorId, modelId, modeId, effortId, sessions } = chat
  return { id, title, createdAt, updatedAt, pinned, connectorId, modelId, modeId, effortId, ...(sessions ? { sessions } : {}) }
}

// A turn that never finished: cancelled, and any question it was waiting on closed with it
const cutOff = (m: ChatMessage): ChatMessage => ({
  ...m,
  status: "cancelled",
  parts: m.parts.map((p) => (p.type === "permission" && !p.outcome ? { ...p, outcome: "cancelled" } : p)),
})

// Image previews are object URLs that only live in the window that made them
function clean(message: ChatMessage): ChatMessage {
  if (!message.attachments?.some((a) => a.previewUrl)) return message
  return { ...message, attachments: message.attachments.map(({ previewUrl: _url, ...rest }) => rest) }
}
