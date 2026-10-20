import { t } from "@lingui/core/macro"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { applyUpdate, DEFAULT_ROLE, type Role, withoutAgentError } from "@owlit/protocol"
import { isDesktop, rpc } from "@/lib/rpc"
import { agentClient } from "./agent"
import * as disk from "./disk"
import { builtInConnectors } from "./mocks/connectors"
import { seedChats } from "./mocks/chats"
import { optionFor, pendingAsk } from "./status"
import { useAskDraft } from "./ask-draft"
import { useComposerDrafts } from "./composer-drafts"
import { connectorSlice, watchConnectors, withConnector, type ConnectorSlice } from "./connectors"
import { resolveSelection, roleOf, selectionOf, type Selection } from "./lib/selection"
import { titleFrom } from "./lib/title"
import type { Chat, ChatMessage, PromptInput, QuestionAnswer, SessionUpdate } from "@owlit/protocol"
import type { RunningTurn } from "./agent/client"

// Chats deleted in this window, for Undo in the browser build (the desktop app's are in .owlit/trash/)
const deleted = new Map<string, Chat>()

// In the desktop app chats live in the workspace (.owlit/chats/, through ./disk); in a plain browser
// (pnpm dev:web) seeded chats are kept in localStorage.
export interface ChatState extends ConnectorSlice {
  chats: Record<string, Chat>
  // Whether the workspace's chat list has been read
  chatsLoaded: boolean
  selection: Selection
  // The role the composer holds for the chat it is about to start (a new chat starts as Assistant;
  // picking another before the first message gives the new chat that one); not kept across restarts
  newChatRole: Role
  // The chats with a running turn, each with its reply's id. A mirror of the agent client's turns (core's,
  // in the desktop app), which are the only record of what runs: set when a turn is sent or found running,
  // cleared when the client says it ended.
  streaming: Record<string, string>
  // What the person sent while a chat's turn ran, one message per chat: sent when the turn ends
  queued: Record<string, PromptInput>

  createChat: (init?: Partial<Pick<Chat, "id" | "connectorId" | "modelId" | "role" | "effortId" | "help">>) => Chat
  deleteChat: (id: string) => void
  // Brings a deleted chat back, with its files (Undo)
  restoreChat: (id: string) => Promise<void>
  // A file sent with a message was added to the Library from its chip
  setAttachmentPaper: (chatId: string, messageId: string, attachmentId: string, paperId: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  setSelection: (patch: Partial<Selection>) => void
  setChatSelection: (chatId: string, patch: Partial<Selection>) => void
  // The role of one chat, or of the chat about to start when there is none
  setChatRole: (chatId: string | undefined, role: Role) => void

  // Starts a turn; while one runs, answers what it waits on or queues the message for when it ends
  send: (chatId: string, input: PromptInput) => Promise<void>
  // Takes back the message queued for when the turn ends
  unqueue: (chatId: string) => void
  cancel: (chatId: string) => void
  respondPermission: (chatId: string, requestId: string, optionId: string) => void
  // Takes messages out of a chat, here and on disk
  removeMessages: (chatId: string, messageIds: string[]) => void
  answerQuestion: (chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) => void
}

// The state with one chat changed; the same state when the chat is gone
const patchChat = (s: ChatState, chatId: string, fn: (c: Chat) => Chat): ChatState | Pick<ChatState, "chats"> => {
  const c = s.chats[chatId]
  return c ? { chats: { ...s.chats, [chatId]: fn(c) } } : s
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get, store) => ({
      ...connectorSlice(set, get, store),
      chats: isDesktop ? {} : Object.fromEntries(seedChats.map((c) => [c.id, c])),
      chatsLoaded: !isDesktop,
      selection: {
        connectorId: builtInConnectors[0].id,
        modelId: builtInConnectors[0].defaultModelId,
        effortId: builtInConnectors[0].defaultEffortId,
      },
      newChatRole: DEFAULT_ROLE,
      streaming: {},
      queued: {},

      createChat(init) {
        const { selection, newChatRole } = get()
        const now = Date.now()
        const chat: Chat = {
          id: crypto.randomUUID(),
          // Saved as said now; the first question replaces it
          title: t`New chat`,
          createdAt: now,
          updatedAt: now,
          pinned: false,
          connectorId: selection.connectorId,
          modelId: selection.modelId,
          role: newChatRole,
          effortId: selection.effortId,
          ...init,
          messages: [],
        }
        // The role picked for this chat went with it; the next one starts as Assistant again
        set((s) => ({ chats: { ...s.chats, [chat.id]: chat }, newChatRole: DEFAULT_ROLE }))
        if (disk.onDisk) {
          const { messages: _none, ...summary } = chat
          disk.createChatOnDisk(summary)
        }
        return chat
      },

      deleteChat(id) {
        get().unqueue(id)
        get().cancel(id)
        useComposerDrafts.getState().drop(id)
        const removed = get().chats[id]
        if (removed) deleted.set(id, removed)
        set((s) => {
          const { [id]: _removed, ...rest } = s.chats
          return { chats: rest }
        })
        if (disk.onDisk) disk.deleteChatOnDisk(id)
      },

      async restoreChat(id) {
        // In the desktop app the chat comes back from .owlit/trash/, its files with it
        const chat = disk.onDisk ? await disk.restoreChatOnDisk(id) : deleted.get(id)
        deleted.delete(id)
        if (chat) set((s) => ({ chats: { ...s.chats, [id]: chat } }))
      },

      setAttachmentPaper(chatId, messageId, attachmentId, paperId) {
        const message = get().chats[chatId]?.messages.find((m) => m.id === messageId)
        if (!message?.attachments) return
        const next = { ...message, attachments: message.attachments.map((a) => (a.id === attachmentId ? { ...a, paperId } : a)) }
        patchMessage(chatId, messageId, () => next)
        if (disk.onDisk) disk.patchMessageOnDisk(chatId, next)
      },

      renameChat(id, title) {
        const chat = get().chats[id]
        if (!chat) return
        const next = title.trim() || chat.title
        set((s) => patchChat(s, id, (c) => ({ ...c, title: next })))
        if (disk.onDisk) disk.updateChatOnDisk(id, { title: next })
      },

      togglePin(id) {
        const chat = get().chats[id]
        if (!chat) return
        set((s) => patchChat(s, id, (c) => ({ ...c, pinned: !chat.pinned })))
        if (disk.onDisk) disk.updateChatOnDisk(id, { pinned: !chat.pinned })
      },

      setSelection(patch) {
        set((s) => {
          const next = { ...s.selection, ...patch }
          // Changing connector resets model and effort to its defaults
          if (patch.connectorId && patch.connectorId !== s.selection.connectorId) {
            const c = s.connectors.find((x) => x.id === patch.connectorId)
            next.modelId = c?.defaultModelId
            next.effortId = c?.defaultEffortId
          }
          return { selection: next }
        })
      },

      setChatSelection(chatId, patch) {
        get().setSelection(patch)
        if (!get().chats[chatId]) return
        const { connectorId, modelId, effortId } = get().selection
        set((s) => patchChat(s, chatId, (c) => ({ ...c, connectorId, modelId, effortId })))
        if (disk.onDisk) disk.updateChatOnDisk(chatId, { connectorId, modelId, effortId })
      },

      setChatRole(chatId, role) {
        if (!chatId || !get().chats[chatId]) return set({ newChatRole: role })
        set((s) => patchChat(s, chatId, (c) => ({ ...c, role })))
        if (disk.onDisk) disk.updateChatOnDisk(chatId, { role })
      },

      async send(chatId, input) {
        const state = get()
        const chat = state.chats[chatId]
        if (!chat) return
        if (state.streaming[chatId]) {
          // While Owlit works, what the person sends is their next message, sent when the turn ends; the
          // turn goes on. Waiting on a question, their words are their own answer to it, and any files
          // and mentions go as the next message. Waiting on a command, it means "no, do this instead":
          // the request is refused and the words go next (refusing a command never stops the turn).
          const ask = pendingAsk(chat)
          if (ask?.type === "question" && input.text.trim()) {
            useAskDraft.getState().type(chatId, ask, input.text.replace(MENTION, "$1"))
            if (!input.attachments.length && !input.mentions.length) return
            input = { ...input, text: input.text.match(MENTION)?.join(" ") ?? "" }
          } else if (ask?.type === "permission") {
            const reject = optionFor(ask.options, false)
            if (reject) get().respondPermission(chatId, ask.requestId, reject.optionId)
          }
          set((s) => ({ queued: { ...s.queued, [chatId]: joined(s.queued[chatId], input) } }))
          return
        }
        // What the pickers show: a model the agent no longer lists (such as Claude Code's "default", which
        // owlit doesn't show) is the agent's own default. Until core has listed the agents there is nothing
        // to check the chat's choice against, and it goes as it is.
        const selection = selectionOf(chat, state.selection)
        const { connector, model, effort } = resolveSelection(state.connectors, selection)
        const role = roleOf(chat)
        const connectorId = connector?.id ?? selection.connectorId
        const modelId = connector ? model?.id : selection.modelId
        const effortId = connector ? effort?.id : selection.effortId
        const now = Date.now()

        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          createdAt: now,
          parts: [{ type: "text", text: input.text }],
          mentions: input.mentions,
          attachments: input.attachments,
          context: input.context,
          selection: input.selection,
        }
        const assistantMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          createdAt: now + 1,
          parts: [],
          status: "streaming",
          connectorId,
          modelId,
        }
        const isFirst = chat.messages.length === 0

        set((s) => ({
          ...patchChat(s, chatId, (c) => ({
            ...c,
            title: isFirst ? titleFrom(input.text) : c.title,
            updatedAt: now,
            messages: [...c.messages, userMsg, assistantMsg],
          })),
          streaming: { ...s.streaming, [chatId]: assistantMsg.id },
          connectors: connector?.status === "available" ? withConnector(s.connectors, { ...connector, status: "connected" }) : s.connectors,
        }))
        if (disk.onDisk && isFirst) disk.updateChatOnDisk(chatId, { title: titleFrom(input.text) })

        // The reply grows and ends through the client's onUpdate and onEnded (followUpdate, turnEnded); the
        // call's own result only matters when nothing said the turn ended
        let ending: Partial<ChatMessage>
        try {
          // A chat made just now must reach core before core can run a turn in it
          if (disk.onDisk) await disk.settled()
          const stop = await agentClient.prompt({ chatId, connectorId, modelId, role: role.id, effortId, input, userMessage: userMsg, assistantMessageId: assistantMsg.id })
          ending = { status: stop === "cancelled" ? "cancelled" : "done" }
        } catch (e) {
          // Core may say more than its sentence: how the agent's process ended, for Details
          const detail = (e as { data?: { detail?: unknown } }).data?.detail
          ending = { status: "error", error: e instanceof Error ? e.message : String(e), ...(typeof detail === "string" ? { errorDetail: detail } : {}) }
        }
        if (runs(chatId, assistantMsg.id)) await settle(chatId, assistantMsg.id, ending)
      },

      unqueue(chatId) {
        set((s) => {
          if (!s.queued[chatId]) return s
          const { [chatId]: _gone, ...rest } = s.queued
          return { queued: rest }
        })
      },

      // A message queued meanwhile still goes once the turn has stopped: "stop, and do this instead"
      cancel(chatId) {
        agentClient.cancel(chatId)
      },

      removeMessages(chatId, messageIds) {
        const gone = new Set(messageIds)
        set((s) => patchChat(s, chatId, (c) => ({ ...c, messages: c.messages.filter((m) => !gone.has(m.id)) })))
        if (disk.onDisk) disk.removeMessagesOnDisk(chatId, messageIds)
      },

      respondPermission(chatId, requestId, optionId) {
        agentClient.respondPermission(chatId, requestId, optionId)
      },

      answerQuestion(chatId, requestId, answers) {
        agentClient.answerQuestion(chatId, requestId, answers)
      },
    }),
    {
      name: "owlit.chat",
      version: 1,
      // In the desktop app chats are the workspace's, not this browser profile's
      partialize: (s) => (isDesktop ? { selection: s.selection } : { chats: s.chats, connectors: s.connectors, selection: s.selection }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatState>
        // Built-in connectors take their definition (models, efforts) from code and only
        // their probe result from storage, so shipping a new field doesn't need a reset. Custom
        // connectors are stored whole. Stale "checking"/"connected" flags are reset.
        const stored = p.connectors ?? []
        const custom = stored.filter((c) => !c.builtIn)
        const connectors = isDesktop ? current.connectors : [
          ...builtInConnectors.map((def) => {
            const saved = stored.find((c) => c.id === def.id)
            return saved ? { ...def, status: saved.status, version: saved.version, authenticated: saved.authenticated, error: saved.error } : def
          }),
          ...custom,
        ].map((c) => (c.status === "checking" || c.status === "connected" ? { ...c, status: "available" as const } : c))
        const chats = Object.fromEntries(
          Object.entries(isDesktop ? current.chats : (p.chats ?? current.chats)).map(([id, c]) => [
            id,
            { ...c, messages: c.messages.map((m) => (m.status === "streaming" ? cutOff(m) : m)) },
          ]),
        )
        // A selection saved by an earlier owlit may carry a mode or a role; neither is kept
        const { modeId: _mode, role: _role, ...saved } = (p.selection ?? {}) as Partial<Selection> & { modeId?: string; role?: string }
        const selection = { ...current.selection, ...saved }
        return { ...current, ...p, selection, connectors, chats, newChatRole: current.newChatRole }
      },
    },
  ),
)

function patchMessage(chatId: string, messageId: string, fn: (m: ChatMessage) => ChatMessage) {
  useChatStore.setState((s) =>
    s.chats[chatId]?.messages.some((m) => m.id === messageId) ? patchChat(s, chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)) })) : s,
  )
}

// A reply the browser build was streaming when its page went away: said as core says it of a turn owlit
// closed on
const cutOff = (m: ChatMessage): ChatMessage => ({ ...m, status: "error", error: t`Owlit was closed before it finished.`, cutOff: "closed" })

// Whether this reply's turn is the chat's running one
const runs = (chatId: string, messageId: string) => useChatStore.getState().streaming[chatId] === messageId

// Replies of running turns whose chat's messages haven't been read yet, by message id: they take the
// updates meanwhile and replace what is read (withHeld)
const held = new Map<string, { chatId: string; message: ChatMessage }>()

// One update of a turn's reply: into the reply, or into the copy held for it. A reply still streaming
// that takes updates is a running turn, whoever started it.
export function followUpdate(chatId: string, messageId: string, update: SessionUpdate) {
  const kept = held.get(messageId)
  if (kept) kept.message = { ...kept.message, parts: applyUpdate(kept.message.parts, update) }
  useChatStore.setState((s) => {
    const reply = s.chats[chatId]?.messages.find((m) => m.id === messageId)
    if (reply?.status !== "streaming") return s
    return {
      ...patchChat(s, chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m === reply ? { ...m, parts: applyUpdate(m.parts, update) } : m)) })),
      ...(s.streaming[chatId] === messageId ? {} : { streaming: { ...s.streaming, [chatId]: messageId } }),
    }
  })
}

// A turn ended, with its reply as saved: the reply takes it and the chat stops working. What the person
// sent meanwhile goes next. A reply that finished while the user was elsewhere waits on its row until
// seen (app/seen.ts hears it end).
export function turnEnded(chatId: string, messageId: string, message: ChatMessage) {
  held.delete(messageId)
  const wasRunning = runs(chatId, messageId)
  useChatStore.setState((s) => {
    const replaced = s.chats[chatId]?.messages.some((m) => m.id === messageId)
      ? patchChat(s, chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? message : m)) }))
      : {}
    if (s.streaming[chatId] !== messageId) return replaced
    const { [chatId]: _done, ...rest } = s.streaming
    return { ...replaced, streaming: rest }
  })
  const next = useChatStore.getState().queued[chatId]
  if (!wasRunning || !next) return
  useChatStore.getState().unqueue(chatId)
  void useChatStore.getState().send(chatId, next)
}

// The turns running when the window opened the workspace: each chat works again, its reply replaced by
// the turn's (newer than what was read), or held until the chat's messages are read
export function adoptRunning(turns: RunningTurn[]) {
  useChatStore.setState((s) => {
    let { chats, streaming } = s
    for (const turn of turns) {
      const chat = chats[turn.chatId]
      if (!chat) continue
      streaming = { ...streaming, [turn.chatId]: turn.messageId }
      if (chat.messages.some((m) => m.id === turn.messageId)) {
        chats = { ...chats, [turn.chatId]: { ...chat, messages: chat.messages.map((m) => (m.id === turn.messageId ? turn.message : m)) } }
      } else held.set(turn.messageId, { chatId: turn.chatId, message: turn.message })
    }
    return { chats, streaming }
  })
}

// A chat's messages as read, with the replies held for it in place of what was read
export function withHeld(chatId: string, messages: ChatMessage[]): ChatMessage[] {
  let out = messages
  for (const [id, { chatId: of, message }] of held) {
    if (of !== chatId) continue
    held.delete(id)
    out = out.some((m) => m.id === id) ? out.map((m) => (m.id === id ? message : m)) : [...out, message]
  }
  return out
}

// Another workspace: nothing of the last one's turns is followed
export function forgetTurns() {
  held.clear()
}

// A mention as the composer writes it into the text: @[label]
const MENTION = /@\[([^\]]+)\]/g

// A second message sent while the first still waits joins it, so nothing typed is lost and one goes
function joined(queued: PromptInput | undefined, input: PromptInput): PromptInput {
  if (!queued) return input
  return {
    ...queued,
    text: [queued.text, input.text].filter((x) => x.trim()).join("\n\n"),
    mentions: [...queued.mentions, ...input.mentions.filter((m) => !queued.mentions.some((x) => x.uri === m.uri))],
    attachments: [...queued.attachments, ...input.attachments],
    context: queued.context ?? input.context,
    selection: queued.selection ?? input.selection,
  }
}

// The turn's call returned and nothing said it ended (core refused it before it began, or the notice was
// lost on its way): what core saved is the reply, else what the call said
async function settle(chatId: string, messageId: string, ending: Partial<ChatMessage>) {
  const saved = isDesktop ? (await rpc.chats.get({ id: chatId }).catch(() => null))?.messages.find((m) => m.id === messageId) : undefined
  const mine = useChatStore.getState().chats[chatId]?.messages.find((m) => m.id === messageId)
  if (!runs(chatId, messageId) || !mine) return
  turnEnded(chatId, messageId, saved && saved.status !== "streaming" ? saved : withoutAgentError({ ...mine, ...ending, finishedAt: Date.now() }))
}

agentClient.onUpdate(followUpdate)
agentClient.onEnded(turnEnded)
watchConnectors(useChatStore)
