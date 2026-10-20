import { t } from "@lingui/core/macro"
import type { Chat, ChatMessage, ChatSummary } from "@owlit/protocol"
import { hasCore, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { beforeWorkspaceSwitch, onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { createDiskFlag, createWorkspaceQueue } from "@/lib/write-queue"
import { agentClient } from "./agent"
import { adoptRunning, forgetTurns, useChatStore, withHeld } from "./store"

// The chat store's link to .owlit/chats/. The store changes at once; each change then goes to core in
// order. A turn's messages are core's to save, as it runs the turn.

export const onDisk = hasCore

const queue = createWorkspaceQueue({ onError: (error) => toastError(error, t`Couldn't save the chat.`) })
const enqueue = (op: () => Promise<unknown>) => queue.enqueue(op)

// Up while the store takes chats read from disk, so nothing mistakes them for messages just sent
const diskFlag = createDiskFlag()
export const isChatsFromDisk = diskFlag.isOn
const fromDisk = diskFlag.apply

// The list first, then the turns running now (a window opened or reloaded while one runs takes it up),
// then every chat's messages: the list shows at once, and ⌘K sees whole chats
async function load() {
  const sameWorkspace = queue.tracker()
  const list = await rpc.chats.list()
  if (!sameWorkspace()) return
  fromDisk(() => useChatStore.setState({ chats: Object.fromEntries(list.map((c) => [c.id, { ...c, messages: [] }])), chatsLoaded: true }))
  const running = await agentClient.running().catch(() => [])
  if (!sameWorkspace()) return
  adoptRunning(running)
  // Outside the queue, so sending a message doesn't wait for every old chat to be read
  void loadMessages(list, sameWorkspace)
}

async function loadMessages(list: ChatSummary[], sameWorkspace: () => boolean) {
  for (const summary of list) {
    const chat = await rpc.chats.get({ id: summary.id }).catch(() => null)
    if (!chat || !sameWorkspace()) continue
    fromDisk(() =>
      useChatStore.setState((s) => {
        const mine = s.chats[chat.id]
        // A chat the user has already written in since the list came keeps what it has
        if (!mine || mine.messages.length) return s
        return { chats: { ...s.chats, [chat.id]: { ...mine, messages: withHeld(chat.id, chat.messages) } } }
      }),
    )
  }
}

// Resolves once every change queued so far has reached core (a turn needs its chat to exist there)
export const settled = queue.settled

export const createChatOnDisk = (chat: ChatSummary) => enqueue(() => rpc.chats.create({ chat }))

export const updateChatOnDisk = (id: string, patch: Partial<Omit<ChatSummary, "id" | "createdAt">>) =>
  enqueue(() => rpc.chats.update({ id, patch }))

export const deleteChatOnDisk = (id: string) => enqueue(() => rpc.chats.delete({ id }))

// The chat deleted last under this id, back from .owlit/trash/ with its files; after the delete reached core
export function restoreChatOnDisk(id: string): Promise<Chat> {
  return new Promise((resolve, reject) => enqueue(() => rpc.chats.restore({ id }).then(resolve, (error) => {
    reject(error)
    throw error
  })))
}

export const removeMessagesOnDisk = (id: string, messageIds: string[]) => enqueue(() => rpc.chats.removeMessages({ id, messageIds }))
export const patchMessageOnDisk = (chatId: string, message: ChatMessage) => enqueue(() => rpc.chats.patchMessage({ id: chatId, message, final: true }))

if (onDisk) {
  onWorkspaceOpened(() => {
    queue.reset()
    forgetTurns()
    useChatStore.setState({ chats: {}, streaming: {}, queued: {}, chatsLoaded: false })
    enqueue(load)
  })
  // Opening another workspace drops the queue, so what is queued goes to core first
  beforeWorkspaceSwitch(() => queue.settled())
  // Opened before this module was loaded (a reload of the window)
  queueMicrotask(() => {
    if (useWorkspace.getState().current && !useChatStore.getState().chatsLoaded) enqueue(load)
  })
}
