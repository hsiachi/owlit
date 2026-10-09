import type { ChatMessage, ChatSummary } from "@owlit/protocol"
import { toast } from "sonner"
import { isDesktop, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { useChatStore } from "./store"

// The chat store's link to .owlit/chats/. The store changes at once; each change then goes to core in
// order. A streaming answer is sent at most every SEND_EVERY_MS, and whole once its turn ends; core
// writes it to disk on its own schedule.

export const onDisk = isDesktop

const SEND_EVERY_MS = 250

let chain: Promise<void> = Promise.resolve()
let generation = 0

function enqueue(op: () => Promise<unknown>) {
  const gen = generation
  chain = chain.then(async () => {
    if (gen !== generation) return
    try {
      await op()
    } catch (error) {
      if (gen === generation) toast.error(error instanceof Error ? error.message : "Couldn't save the chat.")
    }
  })
}

// True while the store takes chats read from disk, so nothing mistakes them for messages just sent
let loadingFromDisk = false
export const isChatsFromDisk = () => loadingFromDisk

function fromDisk(update: () => void) {
  loadingFromDisk = true
  try {
    update()
  } finally {
    loadingFromDisk = false
  }
}

// The list first, then every chat's messages: the list shows at once, and Knowledge, ⌘K and docs'
// pending edits see whole chats
async function load() {
  const gen = generation
  const list = await rpc.chats.list()
  if (gen !== generation) return
  fromDisk(() => useChatStore.setState({ chats: Object.fromEntries(list.map((c) => [c.id, { ...c, messages: [] }])), chatsLoaded: true }))
  // Outside the queue, so sending a message doesn't wait for every old chat to be read
  void loadMessages(list, gen)
}

async function loadMessages(list: ChatSummary[], gen: number) {
  for (const summary of list) {
    const chat = await rpc.chats.get({ id: summary.id }).catch(() => null)
    if (!chat || gen !== generation) continue
    fromDisk(() =>
      useChatStore.setState((s) => {
        const mine = s.chats[chat.id]
        // A chat the user has already written in since the list came keeps what it has
        if (!mine || mine.messages.length) return s
        return { chats: { ...s.chats, [chat.id]: { ...mine, messages: chat.messages } } }
      }),
    )
  }
}

export const createChatOnDisk = (chat: ChatSummary) => enqueue(() => rpc.chats.create({ chat }))

export const updateChatOnDisk = (id: string, patch: Partial<Omit<ChatSummary, "id" | "createdAt">>) =>
  enqueue(() => rpc.chats.update({ id, patch }))

export function deleteChatOnDisk(id: string) {
  dropPending(id)
  enqueue(() => rpc.chats.delete({ id }))
}

export const appendMessageOnDisk = (id: string, message: ChatMessage) => enqueue(() => rpc.chats.appendMessage({ id, message }))

// A streamed answer, as it grows: the latest version waits here until it is sent
const pending = new Map<string, { chatId: string; message: ChatMessage; timer: ReturnType<typeof setTimeout> }>()

export function patchMessageOnDisk(chatId: string, message: ChatMessage, final = false) {
  const key = `${chatId}/${message.id}`
  const waiting = pending.get(key)
  if (final) {
    if (waiting) clearTimeout(waiting.timer)
    pending.delete(key)
    enqueue(() => rpc.chats.patchMessage({ id: chatId, message, final: true }))
    return
  }
  if (waiting) {
    waiting.message = message
    return
  }
  const timer = setTimeout(() => {
    const latest = pending.get(key)
    pending.delete(key)
    if (latest) enqueue(() => rpc.chats.patchMessage({ id: chatId, message: latest.message }))
  }, SEND_EVERY_MS)
  pending.set(key, { chatId, message, timer })
}

function dropPending(chatId: string) {
  for (const [key, entry] of pending) {
    if (entry.chatId !== chatId) continue
    clearTimeout(entry.timer)
    pending.delete(key)
  }
}

if (onDisk) {
  onWorkspaceOpened(() => {
    generation++
    for (const entry of pending.values()) clearTimeout(entry.timer)
    pending.clear()
    useChatStore.setState({ chats: {}, streaming: {}, chatsLoaded: false })
    enqueue(load)
  })
  // Opened before this module was loaded (a reload of the window)
  queueMicrotask(() => {
    if (useWorkspace.getState().current && !useChatStore.getState().chatsLoaded) enqueue(load)
  })
}
