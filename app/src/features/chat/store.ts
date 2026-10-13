import { t } from "@lingui/core/macro"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { applyUpdate, DEFAULT_ROLE, withoutAgentError } from "@owlit/protocol"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { agentClient } from "./agent"
import * as disk from "./disk"
import { builtInConnectors } from "./mocks/connectors"
import { seedChats } from "./mocks/chats"
import { optionFor, pendingAsk, useSeenStore } from "./status"
import { useAskDraft } from "./ask-draft"
import { connectorSlice, watchConnectors, withConnector, type ConnectorSlice } from "./connectors"
import { resolveSelection, selectionOf, type Selection } from "./lib/selection"
import { titleFrom } from "./lib/title"
import type { QuestionAnswer } from "@owlit/protocol"
import type { Chat, ChatMessage, PromptInput } from "./types"

// Whether the store saves messages through ./disk (core saves them itself when it runs the turn)
const savesMessages = () => disk.onDisk && !agentClient.persistsMessages

// Chats deleted in this window, for Undo in the browser build (the desktop app's are in .owlit/trash/)
const deleted = new Map<string, Chat>()

// Abort controllers for in-flight turns, and when each turn is over; not part of persisted state
const inflight = new Map<string, AbortController>()
const over = new Map<string, Promise<void>>()

// In the desktop app chats live in the workspace (.owlit/chats/, through ./disk); in a plain browser
// (pnpm dev:web) seeded chats are kept in localStorage as before.
export interface ChatState extends ConnectorSlice {
  chats: Record<string, Chat>
  // Whether the workspace's chat list has been read
  chatsLoaded: boolean
  selection: Selection
  // Chat ids with a running turn
  streaming: Record<string, true>

  createChat: (init?: Partial<Pick<Chat, "id" | "connectorId" | "modelId" | "role" | "effortId">>) => Chat
  deleteChat: (id: string) => void
  // Brings a deleted chat back, with its files (Undo)
  restoreChat: (id: string) => Promise<void>
  // A file sent with a message was added to the Library from its chip
  setAttachmentPaper: (chatId: string, messageId: string, attachmentId: string, paperId: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  setSelection: (patch: Partial<Selection>) => void
  setChatSelection: (chatId: string, patch: Partial<Selection>) => void

  send: (chatId: string, input: PromptInput) => Promise<void>
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
        role: DEFAULT_ROLE,
        effortId: builtInConnectors[0].defaultEffortId,
      },
      streaming: {},

      createChat(init) {
        const { selection } = get()
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
          role: selection.role,
          effortId: selection.effortId,
          ...init,
          messages: [],
        }
        set((s) => ({ chats: { ...s.chats, [chat.id]: chat } }))
        if (disk.onDisk) {
          const { messages: _none, ...summary } = chat
          disk.createChatOnDisk(summary)
        }
        return chat
      },

      deleteChat(id) {
        get().cancel(id)
        useSeenStore.getState().forget(id)
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
        if (disk.onDisk) disk.patchMessageOnDisk(chatId, next, true)
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
          // Changing connector resets model and effort to its defaults; the role is Owlit's and stays
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
        const { connectorId, modelId, role, effortId } = get().selection
        set((s) => patchChat(s, chatId, (c) => ({ ...c, connectorId, modelId, role, effortId })))
        if (disk.onDisk) disk.updateChatOnDisk(chatId, { connectorId, modelId, role, effortId })
      },

      async send(chatId, input) {
        const state = get()
        const chat = state.chats[chatId]
        if (!chat) return
        if (state.streaming[chatId]) {
          // While Owlit waits on the user, what they type answers it. To a question it is their own
          // answer; to a permission it means "no, do this instead": the request is refused, the turn
          // stopped, and the message sent once it has.
          const ask = pendingAsk(chat)
          if (ask?.type === "question") return useAskDraft.getState().type(chatId, ask, input.text)
          if (ask?.type !== "permission") return
          const reject = optionFor(ask.options, false)
          if (reject) get().respondPermission(chatId, ask.requestId, reject.optionId)
          get().cancel(chatId)
          await over.get(chatId)
          return get().send(chatId, input)
        }
        // What the pickers show: a model the agent no longer lists (such as Claude Code's "default", which
        // owlit doesn't show) is the agent's own default. Until core has listed the agents there is nothing
        // to check the chat's choice against, and it goes as it is.
        const selection = selectionOf(chat, state.selection)
        const { connector, model, effort, role } = resolveSelection(state.connectors, selection)
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
          streaming: { ...s.streaming, [chatId]: true },
          connectors: connector?.status === "available" ? withConnector(s.connectors, { ...connector, status: "connected" }) : s.connectors,
        }))
        if (disk.onDisk) {
          if (isFirst) disk.updateChatOnDisk(chatId, { title: titleFrom(input.text) })
          if (savesMessages()) {
            disk.appendMessageOnDisk(chatId, userMsg)
            disk.appendMessageOnDisk(chatId, assistantMsg)
          }
        }

        const controller = new AbortController()
        inflight.set(chatId, controller)
        let endTurn = () => {}
        over.set(chatId, new Promise<void>((resolve) => (endTurn = resolve)))

        // The answer as it grows; on disk at a measured pace, and whole once the turn is over
        const patchAssistant = (fn: (m: ChatMessage) => ChatMessage, final = false) => {
          patchMessage(chatId, assistantMsg.id, fn)
          const now = get().chats[chatId]?.messages.find((m) => m.id === assistantMsg.id)
          if (now && savesMessages()) disk.patchMessageOnDisk(chatId, now, final)
        }

        let ended: TurnEnd = "finished"
        try {
          // A chat made just now must reach core before core can run a turn in it
          if (disk.onDisk) await disk.settled()
          const stop = await agentClient.prompt(
            { chatId, connectorId, modelId, role: role.id, effortId, input, userMessage: userMsg, assistantMessageId: assistantMsg.id },
            (u) => patchAssistant((m) => ({ ...m, parts: applyUpdate(m.parts, u) })),
            controller.signal,
          )
          if (stop === "cancelled") ended = "cancelled"
          // Unless the agent has already taken the reply up again (lateReply), which has the reply as it is
          if (!late.has(chatId)) patchAssistant((m) => ({ ...m, status: stop === "cancelled" ? "cancelled" : "done", finishedAt: Date.now() }), true)
        } catch (e) {
          ended = "failed"
          // Core may say more than its sentence: how the agent's process ended, for Details
          const detail = (e as { data?: { detail?: unknown } }).data?.detail
          patchAssistant(
            (m) =>
              withoutAgentError({
                ...m,
                status: "error",
                finishedAt: Date.now(),
                error: e instanceof Error ? e.message : String(e),
                ...(typeof detail === "string" ? { errorDetail: detail } : {}),
              }),
            true,
          )
        } finally {
          // What core saved is the answer: a streamed update can go missing on its way here (a reply once
          // showed only its first letter), and this side never hears it again
          if (agentClient.persistsMessages && isDesktop) {
            const saved = (await rpc.chats.get({ id: chatId }).catch(() => null))?.messages.find((m) => m.id === assistantMsg.id)
            if (saved && saved.status !== "streaming" && !late.has(chatId)) patchAssistant(() => saved)
          }
          inflight.delete(chatId)
          over.delete(chatId)
          // The agent took the reply up again before its turn was over here: it runs on as that
          if (late.has(chatId)) followLate(chatId)
          else turnOver(chatId, ended)
          endTurn()
        }
      },

      cancel(chatId) {
        inflight.get(chatId)?.abort()
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
        // Built-in connectors take their definition (models, modes, efforts) from code and only
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
            { ...c, messages: c.messages.map((m) => (m.status === "streaming" ? { ...m, status: "cancelled" as const } : m)) },
          ]),
        )
        // A selection saved before roles existed has a mode instead; the role starts at its default
        const { modeId: _mode, ...saved } = (p.selection ?? {}) as Partial<Selection> & { modeId?: string }
        const selection = { ...current.selection, ...saved, role: saved.role ?? current.selection.role }
        return { ...current, ...p, selection, connectors, chats }
      },
    },
  ),
)

function patchMessage(chatId: string, messageId: string, fn: (m: ChatMessage) => ChatMessage) {
  useChatStore.setState((s) =>
    s.chats[chatId]?.messages.some((m) => m.id === messageId) ? patchChat(s, chatId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? fn(m) : m)) })) : s,
  )
}

type TurnEnd = "finished" | "failed" | "cancelled"

// A turn is over and the chat stops working. Work handed off goes on without anyone watching, so how it
// ended waits on its row until seen.
function turnOver(chatId: string, how: TurnEnd) {
  if (useChatStore.getState().chats[chatId]) useSeenStore.getState().ended(chatId, how)
  useChatStore.setState((s) => {
    const { [chatId]: _done, ...rest } = s.streaming
    return { streaming: rest }
  })
}

// ---- Replies the agent takes up again ----

// An agent may go on after its turn has ended (Claude Code writes its answer once its background agents
// report back, after its prompt has come back): core opens the chat's last reply again, says so with
// chat.lateReply, streams what the agent adds as chat.update for that reply, and says again when it ends.
// Here it runs as a turn does: the chat is working, Stop stops it (core cancels the agent's session), what
// the user types waits for it, and a reply that finished while nobody looked keeps its mark until seen.

// Chat → its reply that is open again
const late = new Map<string, string>()
// The stand-in for a turn's controller and end while a reply is open again, as send keeps them
const lateRuns = new Map<string, { controller: AbortController; end: () => void }>()

function followLate(chatId: string) {
  const controller = new AbortController()
  controller.signal.addEventListener("abort", () => void rpc.agents.cancel({ chatId }).catch(() => undefined))
  let end = () => {}
  over.set(chatId, new Promise<void>((resolve) => (end = resolve)))
  inflight.set(chatId, controller)
  lateRuns.set(chatId, { controller, end })
  useChatStore.setState((s) => ({ streaming: { ...s.streaming, [chatId]: true } }))
}

function lateReply(chatId: string, message: ChatMessage) {
  patchMessage(chatId, message.id, () => message)
  if (message.status === "streaming") {
    late.set(chatId, message.id)
    // A turn sent from here that hasn't seen its end yet hands over when it does (send)
    if (!inflight.has(chatId) && useChatStore.getState().chats[chatId]) followLate(chatId)
    return
  }
  if (late.get(chatId) === message.id) late.delete(chatId)
  const run = lateRuns.get(chatId)
  if (!run) return
  lateRuns.delete(chatId)
  if (inflight.get(chatId) !== run.controller) return
  inflight.delete(chatId)
  over.delete(chatId)
  turnOver(chatId, message.status === "cancelled" ? "cancelled" : message.status === "error" ? "failed" : "finished")
  run.end()
}

if (isDesktop) {
  onNotify("chat.lateReply", ({ chatId, message }) => lateReply(chatId, message))
  onNotify("chat.update", ({ chatId, messageId, update }) => {
    if (late.get(chatId) === messageId) patchMessage(chatId, messageId, (m) => ({ ...m, parts: applyUpdate(m.parts, update) }))
  })
}

watchConnectors(useChatStore)
