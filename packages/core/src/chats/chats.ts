import { t } from "@lingui/core/macro"
import { chatFilesDir, RpcErrorCode, sameAbout, type AttachmentFile, type Chat, type ChatAbout, type ChatMessage, type ChatSummary, type StartedChat, type StopReason } from "@owlit/protocol"
import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { ignoreMissing, readJson, writeJsonAtomic } from "../fs-util.ts"
import { RpcFailure } from "../rpc/index.ts"
import { cutOffSentence } from "../agents/failure.ts"
import type { Turns } from "../agents/turns.ts"
import { messageOf, Serial } from "../util.ts"

// How often a streaming chat is written while its messages keep changing
const WRITE_EVERY_MS = 500

// A new chat's composer copies files into the folder of the chat it is about to start; a folder whose
// chat never started is cleared away once it is this old
const DRAFT_KEPT_MS = 24 * 60 * 60 * 1000

interface IndexFile {
  version: 1
  chats: ChatSummary[]
}

type ChatFile = Chat & { version: 1 }

const notFound = (id: string) => new RpcFailure(RpcErrorCode.NotFound, t`That chat is not in the workspace.`, { id })

// The workspace's chats in .owlit/chats/: <id>.json holds a chat whole (its fields and messages), so one
// file can be read on its own; index.json lists them without messages, so the
// list opens without reading every chat, and is rebuilt from the chat files when missing. Chats being
// streamed are written at most every WRITE_EVERY_MS and once more when the turn ends. <id>/files/ holds
// the copies of the files attached to the chat's messages.
export class Chats {
  private readonly dir: string
  private readonly trashDir: string
  private index: Map<string, ChatSummary> | undefined
  private bodies = new Map<string, Chat>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  // Writes, one at a time per workspace, so the index and a chat file never race
  // index.json as last written, so an unchanged one isn't written again
  private indexWritten?: string
  private readonly serial = new Serial((error) => console.error("[core] couldn't write chats", error))

  constructor(owlitDir: string) {
    this.dir = path.join(owlitDir, "chats")
    this.trashDir = path.join(owlitDir, "trash")
  }

  // Your chats, most recently updated first. The chats owlit started (startedBy) are kept here too, but
  // no chat list shows them: their work shows where it lands.
  async list(): Promise<ChatSummary[]> {
    return (await this.all()).filter((c) => !c.startedBy)
  }

  // The chats owlit started, most recent first
  async started(): Promise<ChatSummary[]> {
    return (await this.all()).filter((c) => !!c.startedBy)
  }

  // The chat owlit started last about each thing (of one kind), with its last message
  async startedFor(kind?: ChatAbout["kind"]): Promise<StartedChat[]> {
    const seen = new Set<string>()
    const out: StartedChat[] = []
    for (const c of await this.started()) {
      if (!c.about || (kind && c.about.kind !== kind)) continue
      const key = `${c.about.kind}:${c.about.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const reply = (await this.get(c.id).catch(() => null))?.messages.at(-1)
      out.push({ chatId: c.id, about: c.about, ...(reply ? { reply } : {}) })
    }
    return out
  }

  // The chat owlit started last about this thing
  async latestAbout(about: ChatAbout): Promise<ChatSummary | undefined> {
    return (await this.all()).find((c) => c.startedBy && sameAbout(c.about, about))
  }

  private async all() {
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
      throw new RpcFailure(RpcErrorCode.Unavailable, t`owlit couldn't read that chat just now.`, { id, reason: messageOf(error) })
    })
    // A turn that was streaming when owlit last stopped never finished
    const messages = (stored?.messages ?? []).map((m) => (m.status === "streaming" ? cutOff(m) : m))
    const chat: Chat = { ...summary, messages }
    this.bodies.set(id, chat)
    return chat
  }

  async create(summary: ChatSummary) {
    const index = await this.loadIndex()
    if (index.has(summary.id)) throw new RpcFailure(RpcErrorCode.Conflict, t`A chat with that id already exists.`, { id: summary.id })
    const chat: Chat = { ...summary, messages: [] }
    index.set(chat.id, summary)
    this.bodies.set(chat.id, chat)
    await this.write(chat.id, true)
    return summary
  }

  // Title, pin, the agent and its settings, the time it was last used, or its project ("" for none)
  async update(id: string, patch: Partial<Omit<ChatSummary, "id" | "createdAt">>) {
    const chat = await this.get(id)
    const next = { ...chat, ...patch }
    if (!next.project) delete next.project
    this.bodies.set(id, next)
    ;(await this.loadIndex()).set(id, summaryOf(next))
    await this.write(id, true)
    return summaryOf(next)
  }

  // To .owlit/trash/<stamp>-chat-<id>/, whole (chat.json, and files/ with the copies of its attached
  // files), so restore() can put it back
  async delete(id: string) {
    const chat = await this.get(id)
    clearTimeout(this.timers.get(id))
    this.timers.delete(id)
    ;(await this.loadIndex()).delete(id)
    this.bodies.delete(id)
    await this.serial.run(async () => {
      const entry = path.join(this.trashDir, `${Date.now()}-chat-${id}`)
      await writeJsonAtomic(path.join(entry, "chat.json"), { version: 1, ...chat })
      await rename(this.filesDir(id), path.join(entry, "files")).catch(ignoreMissing)
      await rm(path.join(this.dir, id), { recursive: true, force: true })
      await rm(this.fileOf(id), { force: true })
      await this.writeIndex()
    })
    return null
  }

  // The chat deleted last under this id, back with its files (Undo). Chats trashed by older builds were
  // a single <stamp>-chat-<id>.json and come back the same way.
  async restore(id: string): Promise<Chat> {
    const index = await this.loadIndex()
    if (index.has(id)) throw new RpcFailure(RpcErrorCode.Conflict, t`That chat is already in the workspace.`, { id })
    const suffix = `-chat-${id}`
    const entries = (await readdir(this.trashDir).catch(() => [] as string[])).filter((n) => n.endsWith(suffix) || n.endsWith(`${suffix}.json`)).sort().reverse()
    const entry = entries[0]
    if (!entry) throw new RpcFailure(RpcErrorCode.NotFound, t`That chat is no longer in the trash.`, { id })
    const from = path.join(this.trashDir, entry)
    const legacy = entry.endsWith(".json")
    const stored = await readJson<ChatFile>(legacy ? from : path.join(from, "chat.json"))
    if (!stored || stored.id !== id) throw new RpcFailure(RpcErrorCode.NotFound, t`That chat is no longer in the trash.`, { id })
    const { version: _v, ...chat } = stored
    return this.serial.run(async () => {
      if (!legacy) {
        await mkdir(path.join(this.dir, id), { recursive: true })
        await rename(path.join(from, "files"), this.filesDir(id)).catch(ignoreMissing)
      }
      index.set(id, summaryOf(chat))
      this.bodies.set(id, chat)
      await writeJsonAtomic(this.fileOf(id), { version: 1, ...chat })
      await this.writeIndex()
      await rm(from, { recursive: true, force: true })
      return chat
    })
  }

  // ---- Attached files: copies in <id>/files/, named as the file was ("report 2.pdf" beside an earlier
  // "report.pdf"). The chat need not exist yet: a new chat's composer copies into the folder of the chat
  // it will start. Paths are relative to the workspace, as messages keep them.

  // Copies a file the user has on disk
  async copyIn(id: string, source: string, name: string) {
    return this.place(id, name, (dest) => copyFile(source, dest, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE))
  }

  // Keeps bytes that came without a file (a pasted image)
  async writeIn(id: string, name: string, bytes: Uint8Array) {
    return this.place(id, name, (dest) => writeFile(dest, bytes, { flag: "wx" }))
  }

  // A copy whose chip was removed before sending. One that a message of the chat still points at stays:
  // that message was sent with it.
  async removeFile(id: string, rel: string) {
    const name = this.fileName(id, rel)
    const chat = (await this.loadIndex()).has(id) ? await this.get(id) : null
    if (chat?.messages.some((m) => m.attachments?.some((a) => a.path === rel))) return null
    await rm(path.join(this.filesDir(id), name), { force: true })
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

  // Takes messages out of a chat: a reply that broke and the question it answered, when Retry asks again
  async removeMessages(id: string, messageIds: string[]) {
    const chat = await this.get(id)
    const gone = new Set(messageIds)
    this.bodies.set(id, { ...chat, messages: chat.messages.filter((m) => !gone.has(m.id)) })
    await this.write(id, true)
    return null
  }

  // Replaces a message by id (a streamed answer as it grows); final writes it out at once
  async patchMessage(id: string, message: ChatMessage, final = false) {
    const chat = await this.get(id)
    if (!chat.messages.some((m) => m.id === message.id)) throw notFound(`${id}/${message.id}`)
    // A finished answer moves updatedAt to its end: changes.unseen looks only at chats updated after the
    // person's mark on them, and an answer that started before the mark but ended after must still be found
    const updatedAt = Math.max(chat.updatedAt, message.finishedAt ?? 0)
    const next = { ...chat, updatedAt, messages: chat.messages.map((m) => (m.id === message.id ? clean(message) : m)) }
    this.bodies.set(id, next)
    if (updatedAt !== chat.updatedAt) (await this.loadIndex()).set(id, summaryOf(next))
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
    await this.serial.idle
  }

  // ---- inside ----

  private filesDir(id: string) {
    this.fileOf(id)
    return path.join(this.dir, id, "files")
  }

  // The name of a copy in this chat's folder, from its workspace-relative path; anything else is refused
  private fileName(id: string, rel: string) {
    const prefix = `${chatFilesDir(id)}/`
    const name = rel.startsWith(prefix) ? rel.slice(prefix.length) : ""
    if (!name || name.includes("/") || name === "." || name === "..") throw new RpcFailure(RpcErrorCode.InvalidParams, t`That isn't a file of this chat.`, { path: rel })
    return name
  }

  // Writes under the file's own name, or the first free "name N.ext" after it
  private async place(id: string, name: string, write: (dest: string) => Promise<void>) {
    const dir = this.filesDir(id)
    await mkdir(dir, { recursive: true })
    const clean = safeName(name)
    const ext = path.extname(clean)
    const stem = clean.slice(0, clean.length - ext.length) || "file"
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? clean : `${stem} ${n}${ext}`
      try {
        await write(path.join(dir, candidate))
        return `${chatFilesDir(id)}/${candidate}`
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || n > 999) throw error
      }
    }
  }

  private fileOf(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new RpcFailure(RpcErrorCode.InvalidParams, "That is not a chat id.", { id })
    return path.join(this.dir, `${id}.json`)
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
    return this.serial.run(async () => {
      const chat = this.bodies.get(id)
      if (!chat) return
      await writeJsonAtomic(this.fileOf(id), { version: 1, ...chat })
      await this.writeIndex()
    })
  }

  // Only when a summary changed: a streaming answer writes its chat every WRITE_EVERY_MS, and the index
  // has nothing new most of those times
  private async writeIndex() {
    const index = await this.loadIndex()
    const file: IndexFile = { version: 1, chats: [...index.values()].sort((a, b) => b.updatedAt - a.updatedAt) }
    const text = JSON.stringify(file)
    if (text === this.indexWritten) return
    await writeJsonAtomic(path.join(this.dir, "index.json"), file)
    this.indexWritten = text
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
    await this.sweepDrafts(names, index)
    return index
  }

  // Folders of files for chats that never started (a new chat's composer, left without sending), once
  // they are a day old. Only copies are lost: the originals were never touched.
  private async sweepDrafts(names: string[], index: Map<string, ChatSummary>) {
    const files = new Set(names)
    for (const name of names) {
      if (name.includes(".") || index.has(name) || files.has(`${name}.json`)) continue
      const folder = path.join(this.dir, name)
      const info = await stat(folder).catch(() => null)
      if (info?.isDirectory() && Date.now() - info.mtimeMs > DRAFT_KEPT_MS) await rm(folder, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function summaryOf(chat: Chat | ChatFile): ChatSummary {
  const { id, title, createdAt, updatedAt, pinned, connectorId, modelId, role, effortId, sessions, rules, startedBy, about, help, project } = chat
  return {
    id,
    title,
    createdAt,
    updatedAt,
    pinned,
    connectorId,
    modelId,
    ...(role ? { role } : {}),
    effortId,
    ...(sessions ? { sessions } : {}),
    ...(rules ? { rules } : {}),
    ...(startedBy ? { startedBy, ...(about ? { about } : {}) } : {}),
    ...(help ? { help } : {}),
    ...(project ? { project } : {}),
  }
}

// A turn that never finished, because owlit stopped before its reply was saved: said as owlit closing,
// not as the person's Stop, and any question it was waiting on closed with it
const cutOff = (m: ChatMessage): ChatMessage => ({
  ...m,
  status: "error",
  error: cutOffSentence("closed"),
  cutOff: "closed",
  parts: m.parts.map((p) => (p.type === "permission" && !p.outcome ? { ...p, outcome: "cancelled" } : p)),
})

// Image previews are object URLs that only live in the window that made them
function clean(message: ChatMessage): ChatMessage {
  if (!message.attachments?.some((a) => a.previewUrl)) return message
  return { ...message, attachments: message.attachments.map(({ previewUrl: _url, ...rest }) => rest) }
}

// A file name as it can be kept: no folders, no control characters, not empty
function safeName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? ""
  // oxlint-disable-next-line no-control-regex -- control characters are what is taken out
  const clean = base.replace(/[\u0000-\u001f\u007f:]/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "")
  return clean.slice(0, 200) || "file"
}

// ---- Chats owlit starts for the person ----

// What a chat owlit starts is given: what it works on, its recipe as the first message, and what goes
// with it. The agent and model are Settings' choice for work owlit starts (core.ts).
export interface StartFor {
  about: ChatAbout
  // The chat's name in its file: the work, by name
  title: string
  // What the agent is asked, in English (text for agents is never translated)
  recipe: string
  // Sent as a typed chat sends images: copied into the chat's folder and attached to the first message,
  // so an agent that takes pictures sees them
  pictures?: { name: string; mimeType: string; data: Uint8Array }[]
  // Text the recipe works from (a paper's text), sent after it. The chat keeps where it came from rather
  // than the text itself, which can run to hundreds of pages and is on disk already.
  texts?: { text: string; from: string }[]
  connectorId: string
  modelId?: string
}

export interface Started {
  chatId: string
  // The reply the turn writes
  messageId: string
  // How the turn ended; "error" when it broke (the reply says why)
  done: Promise<StopReason | "error">
}

// Starts a chat for the person about something, as Reviewer, and runs its first turn with no window
// involved: its updates go to the chat's file and to every window (chat.update, chat.ended) as any
// chat's do, Stop is agents.cancel on it, and owlit closing cuts it off as it does any turn.
export async function startFor(turns: Turns, chats: Chats, start: StartFor): Promise<Started> {
  const chatId = randomUUID()
  const now = Date.now()
  await chats.create({ id: chatId, title: start.title, createdAt: now, updatedAt: now, pinned: false, connectorId: start.connectorId, ...(start.modelId ? { modelId: start.modelId } : {}), role: "reviewer", startedBy: "owlit", about: start.about })
  const attachments: AttachmentFile[] = []
  for (const picture of start.pictures ?? []) {
    const kept = await chats.writeIn(chatId, picture.name, picture.data)
    attachments.push({ id: randomUUID(), name: picture.name, size: picture.data.length, mimeType: picture.mimeType, path: kept })
  }
  const texts = start.texts ?? []
  const said = startedWith(start)
  const sent = [start.recipe, ...texts.map((t) => t.text)].join("\n\n")
  return turn(turns, chatId, start.about, { text: said, sent, attachments, connectorId: start.connectorId, modelId: start.modelId })
}

// The first message of a chat startFor began, as the chat keeps it: the recipe, and where each text it
// was sent came from. Two alike were started with the same recipe from the same sources.
export function startedWith(start: Pick<StartFor, "recipe" | "texts">) {
  return [start.recipe, ...(start.texts ?? []).map((t) => `(${t.from} followed here.)`)].join("\n\n")
}

// What Retry says: a new turn in the same chat, so the agent sees what it did before it broke
export const TRY_AGAIN = "Try again."

// The agent and model a later turn runs on: Settings' choice at that moment, which may differ from the
// chat's first turn (the turn then starts that agent's session with the conversation so far)
export type TurnAgent = { connectorId: string; modelId?: string }

// Another turn in a chat owlit started (Retry)
export function tryAgain(turns: Turns, chats: Chats, chatId: string, agent?: TurnAgent): Promise<Started> {
  return askAgain(turns, chats, chatId, TRY_AGAIN, agent)
}

// Another turn in a chat owlit started, asking it this (the person's next reply under a comment, to the
// chat about that comment), on the agent given, else the chat's own
export async function askAgain(turns: Turns, chats: Chats, chatId: string, text: string, agent?: TurnAgent): Promise<Started> {
  const chat = await chats.get(chatId)
  if (!chat.startedBy || !chat.about || !chat.connectorId) throw new RpcFailure(RpcErrorCode.InvalidParams, "That chat wasn't started by owlit for something.", { id: chatId })
  const on = agent ?? { connectorId: chat.connectorId, ...(chat.modelId ? { modelId: chat.modelId } : {}) }
  if (on.connectorId !== chat.connectorId || on.modelId !== chat.modelId) await chats.update(chatId, { connectorId: on.connectorId, modelId: on.modelId })
  return turn(turns, chatId, chat.about, { text, sent: text, attachments: [], connectorId: on.connectorId, modelId: on.modelId })
}

async function turn(turns: Turns, chatId: string, about: ChatAbout, ask: { text: string; sent: string; attachments: AttachmentFile[]; connectorId: string; modelId?: string }): Promise<Started> {
  const userMessage: ChatMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text: ask.text }], ...(ask.attachments.length ? { attachments: ask.attachments } : {}), createdAt: Date.now() }
  const messageId = randomUUID()
  // Not awaited: the turn runs on its own. This returns once its messages are in the chat, or once it
  // ended before they were (a turn already running in the chat)
  let begun = () => {}
  const inChat = new Promise<void>((resolve) => (begun = resolve))
  const done = turns
    .prompt(
      { chatId, connectorId: ask.connectorId, ...(ask.modelId ? { modelId: ask.modelId } : {}), role: "reviewer", input: { text: ask.sent, mentions: [], attachments: ask.attachments }, userMessage, assistantMessageId: messageId },
      { about, begun },
    )
    .catch((): "error" => "error")
  await Promise.race([inChat, done])
  return { chatId, messageId, done }
}
