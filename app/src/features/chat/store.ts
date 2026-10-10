import { create } from "zustand"
import { persist } from "zustand/middleware"
import { applyUpdate, DEFAULT_ROLE, type Role } from "@owlit/protocol"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import type { AgentClient } from "./agent/client"
import * as disk from "./disk"
import { MockAgentClient } from "./agent/mock-client"
import { RpcAgentClient } from "./agent/rpc-client"
import { builtInConnectors } from "./mocks/connectors"
import { seedChats } from "./mocks/chats"
import { pendingAsk, useSeenStore } from "./status"
import { useAskDraft } from "./ask-draft"
import type { QuestionAnswer } from "@owlit/protocol"
import type {
  Chat,
  ChatMessage,
  Connector,
  PromptInput,
} from "./types"

export const agentClient: AgentClient = isDesktop ? new RpcAgentClient() : new MockAgentClient()
// Whether the store saves messages through ./disk (core saves them itself when it runs the turn)
const savesMessages = () => disk.onDisk && !agentClient.persistsMessages

// Abort controllers for in-flight turns, and when each turn is over; not part of persisted state
const inflight = new Map<string, AbortController>()
const over = new Map<string, Promise<void>>()

export interface Selection {
  connectorId: string
  modelId?: string
  // Owlit's role, the same whichever agent runs; it stays when the agent changes
  role: Role
  effortId?: string
}

// In the desktop app chats live in the workspace (.owlit/chats/, through ./disk); in a plain browser
// (pnpm dev:web) seeded chats are kept in localStorage as before.
interface ChatState {
  chats: Record<string, Chat>
  // Whether the workspace's chat list has been read
  chatsLoaded: boolean
  connectors: Connector[]
  selection: Selection
  // Chat ids with a running turn
  streaming: Record<string, true>

  createChat: (init?: Partial<Pick<Chat, "connectorId" | "modelId" | "role" | "effortId">>) => Chat
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  setSelection: (patch: Partial<Selection>) => void
  setChatSelection: (chatId: string, patch: Partial<Selection>) => void

  send: (chatId: string, input: PromptInput) => Promise<void>
  cancel: (chatId: string) => void
  respondPermission: (chatId: string, requestId: string, optionId: string) => void
  answerQuestion: (chatId: string, requestId: string, answers: Record<string, QuestionAnswer> | null) => void

  checkConnector: (id: string) => Promise<void>
  // The agent's own sign-in (the Owlit engine); throws what went wrong, for the form to show
  signInConnector: (id: string, methodId: string, apiKey?: string) => Promise<void>
  signOutConnector: (id: string, methodId?: string) => Promise<void>
  addCustomConnector: (name: string, command: string) => Promise<Connector>
  removeConnector: (id: string) => void
}

// Keep a generous slice and let the list row truncate it with CSS
const titleFrom = (text: string) => {
  const t = text.replace(/@\[([^\]]+)\]/g, "$1").replace(/\s+/g, " ").trim()
  return t.slice(0, 80) || "New chat"
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: isDesktop ? {} : Object.fromEntries(seedChats.map((c) => [c.id, c])),
      chatsLoaded: !isDesktop,
      // In the desktop app core says which agents exist (./connectors); until it answers there are none
      connectors: isDesktop ? [] : builtInConnectors,
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
          title: "New chat",
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
        set((s) => {
          const { [id]: _removed, ...rest } = s.chats
          return { chats: rest }
        })
        if (disk.onDisk) disk.deleteChatOnDisk(id)
      },

      renameChat(id, title) {
        const chat = get().chats[id]
        if (!chat) return
        const next = title.trim() || chat.title
        set((s) => ({ chats: { ...s.chats, [id]: { ...chat, title: next } } }))
        if (disk.onDisk) disk.updateChatOnDisk(id, { title: next })
      },

      togglePin(id) {
        const chat = get().chats[id]
        if (!chat) return
        set((s) => ({ chats: { ...s.chats, [id]: { ...chat, pinned: !chat.pinned } } }))
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
        set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], connectorId, modelId, role, effortId } } }))
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
          const reject = ask.options.find((o) => o.kind === "reject_once") ?? ask.options.find((o) => o.kind.startsWith("reject"))
          if (reject) get().respondPermission(chatId, ask.requestId, reject.optionId)
          get().cancel(chatId)
          await over.get(chatId)
          return get().send(chatId, input)
        }
        const connectorId = chat.connectorId ?? state.selection.connectorId
        // A model the agent no longer lists (such as Claude Code's "default", which owlit doesn't show)
        // falls back to the agent's own default, as the picker shows it
        const connector = state.connectors.find((c) => c.id === connectorId)
        const wanted = chat.modelId ?? state.selection.modelId
        const modelId = !connector || connector.models.some((m) => m.id === wanted) ? wanted : connector.defaultModelId
        const role = chat.role ?? state.selection.role ?? DEFAULT_ROLE
        const effortId = chat.effortId ?? state.selection.effortId
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
          chats: {
            ...s.chats,
            [chatId]: {
              ...s.chats[chatId],
              title: isFirst ? titleFrom(input.text) : s.chats[chatId].title,
              updatedAt: now,
              messages: [...s.chats[chatId].messages, userMsg, assistantMsg],
            },
          },
          streaming: { ...s.streaming, [chatId]: true },
          connectors: s.connectors.map((c) => (c.id === connectorId && c.status === "available" ? { ...c, status: "connected" } : c)),
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
          set((s) => {
            const c = s.chats[chatId]
            if (!c) return s
            return {
              chats: {
                ...s.chats,
                [chatId]: { ...c, messages: c.messages.map((m) => (m.id === assistantMsg.id ? fn(m) : m)) },
              },
            }
          })
          const now = get().chats[chatId]?.messages.find((m) => m.id === assistantMsg.id)
          if (now && savesMessages()) disk.patchMessageOnDisk(chatId, now, final)
        }

        let ended: "finished" | "failed" | "cancelled" = "finished"
        try {
          // A chat made just now must reach core before core can run a turn in it
          if (disk.onDisk) await disk.settled()
          const stop = await agentClient.prompt(
            { chatId, connectorId, modelId, role, effortId, input, userMessage: userMsg, assistantMessageId: assistantMsg.id },
            (u) => patchAssistant((m) => ({ ...m, parts: applyUpdate(m.parts, u) })),
            controller.signal,
          )
          if (stop === "cancelled") ended = "cancelled"
          patchAssistant((m) => ({ ...m, status: stop === "cancelled" ? "cancelled" : "done" }), true)
        } catch (e) {
          ended = "failed"
          patchAssistant((m) => ({ ...m, status: "error", error: e instanceof Error ? e.message : String(e) }), true)
        } finally {
          inflight.delete(chatId)
          over.delete(chatId)
          // Work handed off goes on without anyone watching; how it ended waits on its row until seen
          if (get().chats[chatId]) useSeenStore.getState().ended(chatId, ended)
          set((s) => {
            const { [chatId]: _done, ...rest } = s.streaming
            return { streaming: rest }
          })
          endTurn()
        }
      },

      cancel(chatId) {
        inflight.get(chatId)?.abort()
      },

      respondPermission(chatId, requestId, optionId) {
        agentClient.respondPermission(chatId, requestId, optionId)
      },

      answerQuestion(chatId, requestId, answers) {
        agentClient.answerQuestion(chatId, requestId, answers)
      },

      async checkConnector(id) {
        const c = get().connectors.find((x) => x.id === id)
        if (!c) return
        set((s) => ({ connectors: s.connectors.map((x) => (x.id === id ? { ...x, status: "checking", error: undefined } : x)) }))
        const result = isDesktop ? await rpc.agents.check({ id }).catch((e: Error) => ({ ...c, status: "error" as const, error: e.message })) : await agentClient.check(c)
        set((s) => ({ connectors: s.connectors.map((x) => (x.id === id ? result : x)) }))
      },

      async signInConnector(id, methodId, apiKey) {
        const result = await rpc.agents.signIn({ id, methodId, ...(apiKey ? { apiKey } : {}) })
        set((s) => ({ connectors: s.connectors.map((x) => (x.id === id ? result : x)) }))
      },

      async signOutConnector(id, methodId) {
        const result = await rpc.agents.signOut({ id, ...(methodId ? { methodId } : {}) })
        set((s) => ({ connectors: s.connectors.map((x) => (x.id === id ? result : x)) }))
      },

      async addCustomConnector(name, command) {
        if (isDesktop) {
          const c = await rpc.agents.add({ name, command })
          set((s) => ({ connectors: [...s.connectors, c] }))
          return c
        }
        const c: Connector = {
          id: `custom-${crypto.randomUUID().slice(0, 8)}`,
          name: name.trim() || "Custom agent",
          description: "Custom ACP agent",
          command: command.trim(),
          builtIn: false,
          status: "unknown",
          models: [{ id: "default", name: "Default" }],
          modes: [{ id: "default", name: "Default" }],
          defaultModelId: "default",
          defaultModeId: "default",
        }
        set((s) => ({ connectors: [...s.connectors, c] }))
        return c
      },

      removeConnector(id) {
        if (isDesktop) void rpc.agents.remove({ id }).catch(() => undefined)
        set((s) => {
          const connectors = s.connectors.filter((c) => c.id !== id)
          const selection =
            s.selection.connectorId === id
              ? { connectorId: connectors[0]?.id ?? "", modelId: connectors[0]?.defaultModelId, role: s.selection.role }
              : s.selection
          return { connectors, selection }
        })
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

// ---- Local agents, from core ----

// The pickers show what the agent offers; a remembered model or effort it doesn't offer falls back to the
// agent's own default
function fitSelection(connectors: Connector[]) {
  const { selection } = useChatStore.getState()
  const c = connectors.find((x) => x.id === selection.connectorId) ?? connectors[0]
  if (!c) return
  const pick = <T extends { id: string }>(list: T[] | undefined, id: string | undefined, fallback: string | undefined) =>
    list?.some((x) => x.id === id) ? id : fallback
  useChatStore.setState({
    selection: {
      connectorId: c.id,
      modelId: pick(c.models, selection.modelId, c.defaultModelId),
      role: selection.role ?? DEFAULT_ROLE,
      effortId: pick(c.efforts, selection.effortId, c.defaultEffortId),
    },
  })
}

if (isDesktop) {
  // Agents are this machine's, not the workspace's: listed once, then kept current by core
  void rpc.agents.list().then((connectors) => {
    useChatStore.setState({ connectors })
    fitSelection(connectors)
    // Agents never checked are checked now, so the user never sees an "unknown" state
    for (const c of connectors) if (c.status === "unknown") void useChatStore.getState().checkConnector(c.id)
  })
  onNotify("agents.changed", (connector) => {
    useChatStore.setState((s) => ({ connectors: s.connectors.map((c) => (c.id === connector.id ? connector : c)) }))
    fitSelection(useChatStore.getState().connectors)
  })
}

// ---- Selectors ----

export const selectChatList = (s: ChatState) =>
  Object.values(s.chats).sort((a, b) => b.updatedAt - a.updatedAt)

export const selectConnector = (s: ChatState, id?: string) =>
  s.connectors.find((c) => c.id === (id ?? s.selection.connectorId))
