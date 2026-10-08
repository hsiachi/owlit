import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { AgentClient } from "./agent/client"
import { MockAgentClient } from "./agent/mock-client"
import { builtInConnectors } from "./mocks/connectors"
import { seedChats } from "./mocks/chats"
import type {
  Chat,
  ChatMessage,
  Connector,
  MessagePart,
  PromptInput,
  SessionUpdate,
} from "./types"

export const agentClient: AgentClient = new MockAgentClient()

// Abort controllers for in-flight turns; not part of persisted state
const inflight = new Map<string, AbortController>()

export interface Selection {
  connectorId: string
  modelId?: string
  modeId?: string
  effortId?: string
}

interface ChatState {
  chats: Record<string, Chat>
  connectors: Connector[]
  selection: Selection
  // Chat ids with a running turn
  streaming: Record<string, true>

  createChat: (init?: Partial<Pick<Chat, "connectorId" | "modelId" | "modeId" | "effortId">>) => Chat
  deleteChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  togglePin: (id: string) => void
  setSelection: (patch: Partial<Selection>) => void
  setChatSelection: (chatId: string, patch: Partial<Selection>) => void

  send: (chatId: string, input: PromptInput) => Promise<void>
  cancel: (chatId: string) => void
  respondPermission: (chatId: string, requestId: string, optionId: string) => void

  checkConnector: (id: string) => Promise<void>
  addCustomConnector: (name: string, command: string) => Connector
  removeConnector: (id: string) => void
}

// Keep a generous slice and let the list row truncate it with CSS
const titleFrom = (text: string) => {
  const t = text.replace(/@\[([^\]]+)\]/g, "$1").replace(/\s+/g, " ").trim()
  return t.slice(0, 80) || "New chat"
}

// Fold one streamed update into the assistant message's parts
function applyUpdate(parts: MessagePart[], u: SessionUpdate): MessagePart[] {
  const last = parts[parts.length - 1]
  switch (u.type) {
    case "agent_message_chunk":
      if (last?.type === "text") return [...parts.slice(0, -1), { ...last, text: last.text + u.text }]
      return [...parts, { type: "text", text: u.text }]
    case "agent_thought_chunk":
      if (last?.type === "thought") return [...parts.slice(0, -1), { ...last, text: last.text + u.text }]
      return [...parts, { type: "thought", text: u.text }]
    case "tool_call":
      return [...parts, { type: "tool_call", toolCallId: u.toolCallId, title: u.title, kind: u.kind, status: u.status, content: u.content, locations: u.locations }]
    case "tool_call_update":
      return parts.map((p) =>
        p.type === "tool_call" && p.toolCallId === u.toolCallId
          ? { ...p, status: u.status ?? p.status, title: u.title ?? p.title, content: u.content ?? p.content, locations: u.locations ?? p.locations }
          : p,
      )
    case "plan": {
      const i = parts.findIndex((p) => p.type === "plan")
      const entry: MessagePart = { type: "plan", entries: u.entries }
      return i >= 0 ? parts.map((p, j) => (j === i ? entry : p)) : [...parts, entry]
    }
    case "permission_request":
      return [...parts, { type: "permission", requestId: u.requestId, toolCallId: u.toolCallId, title: u.title, kind: u.kind, options: u.options }]
    case "permission_resolved":
      return parts.map((p) => (p.type === "permission" && p.requestId === u.requestId ? { ...p, outcome: u.outcome } : p))
  }
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      chats: Object.fromEntries(seedChats.map((c) => [c.id, c])),
      connectors: builtInConnectors,
      selection: {
        connectorId: builtInConnectors[0].id,
        modelId: builtInConnectors[0].defaultModelId,
        modeId: builtInConnectors[0].defaultModeId,
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
          modeId: selection.modeId,
          effortId: selection.effortId,
          ...init,
          messages: [],
        }
        set((s) => ({ chats: { ...s.chats, [chat.id]: chat } }))
        return chat
      },

      deleteChat(id) {
        get().cancel(id)
        set((s) => {
          const { [id]: _removed, ...rest } = s.chats
          return { chats: rest }
        })
      },

      renameChat(id, title) {
        set((s) => (s.chats[id] ? { chats: { ...s.chats, [id]: { ...s.chats[id], title: title.trim() || s.chats[id].title } } } : s))
      },

      togglePin(id) {
        set((s) => (s.chats[id] ? { chats: { ...s.chats, [id]: { ...s.chats[id], pinned: !s.chats[id].pinned } } } : s))
      },

      setSelection(patch) {
        set((s) => {
          const next = { ...s.selection, ...patch }
          // Changing connector resets model and mode to its defaults
          if (patch.connectorId && patch.connectorId !== s.selection.connectorId) {
            const c = s.connectors.find((x) => x.id === patch.connectorId)
            next.modelId = c?.defaultModelId
            next.modeId = c?.defaultModeId
            next.effortId = c?.defaultEffortId
          }
          return { selection: next }
        })
      },

      setChatSelection(chatId, patch) {
        get().setSelection(patch)
        set((s) => (s.chats[chatId] ? { chats: { ...s.chats, [chatId]: { ...s.chats[chatId], ...get().selection } } } : s))
      },

      async send(chatId, input) {
        const state = get()
        const chat = state.chats[chatId]
        if (!chat || state.streaming[chatId]) return
        const connectorId = chat.connectorId ?? state.selection.connectorId
        const modelId = chat.modelId ?? state.selection.modelId
        const modeId = chat.modeId ?? state.selection.modeId
        const effortId = chat.effortId ?? state.selection.effortId
        const now = Date.now()

        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          createdAt: now,
          parts: [{ type: "text", text: input.text }],
          mentions: input.mentions,
          attachments: input.attachments,
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

        const controller = new AbortController()
        inflight.set(chatId, controller)

        const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
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

        try {
          const stop = await agentClient.prompt(
            { chatId, connectorId, modelId, modeId, effortId, input },
            (u) => patchAssistant((m) => ({ ...m, parts: applyUpdate(m.parts, u) })),
            controller.signal,
          )
          patchAssistant((m) => ({ ...m, status: stop === "cancelled" ? "cancelled" : "done" }))
        } catch (e) {
          patchAssistant((m) => ({ ...m, status: "error", error: e instanceof Error ? e.message : String(e) }))
        } finally {
          inflight.delete(chatId)
          set((s) => {
            const { [chatId]: _done, ...rest } = s.streaming
            return { streaming: rest }
          })
        }
      },

      cancel(chatId) {
        inflight.get(chatId)?.abort()
      },

      respondPermission(chatId, requestId, optionId) {
        agentClient.respondPermission(chatId, requestId, optionId)
      },

      async checkConnector(id) {
        const c = get().connectors.find((x) => x.id === id)
        if (!c) return
        set((s) => ({ connectors: s.connectors.map((x) => (x.id === id ? { ...x, status: "checking", error: undefined } : x)) }))
        const result = await agentClient.check(c)
        set((s) => ({ connectors: s.connectors.map((x) => (x.id === id ? result : x)) }))
      },

      addCustomConnector(name, command) {
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
        set((s) => {
          const connectors = s.connectors.filter((c) => c.id !== id)
          const selection =
            s.selection.connectorId === id
              ? { connectorId: connectors[0]?.id ?? "", modelId: connectors[0]?.defaultModelId, modeId: connectors[0]?.defaultModeId }
              : s.selection
          return { connectors, selection }
        })
      },
    }),
    {
      name: "owlit.chat",
      version: 1,
      partialize: (s) => ({ chats: s.chats, connectors: s.connectors, selection: s.selection }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatState>
        // Built-in connectors take their definition (models, modes, efforts) from code and only
        // their probe result from storage, so shipping a new field doesn't need a reset. Custom
        // connectors are stored whole. Stale "checking"/"connected" flags are reset.
        const stored = p.connectors ?? []
        const custom = stored.filter((c) => !c.builtIn)
        const connectors = [
          ...builtInConnectors.map((def) => {
            const saved = stored.find((c) => c.id === def.id)
            return saved ? { ...def, status: saved.status, version: saved.version, authenticated: saved.authenticated, error: saved.error } : def
          }),
          ...custom,
        ].map((c) => (c.status === "checking" || c.status === "connected" ? { ...c, status: "available" as const } : c))
        const chats = Object.fromEntries(
          Object.entries(p.chats ?? current.chats).map(([id, c]) => [
            id,
            { ...c, messages: c.messages.map((m) => (m.status === "streaming" ? { ...m, status: "cancelled" as const } : m)) },
          ]),
        )
        return { ...current, ...p, connectors, chats }
      },
    },
  ),
)

// ---- Selectors ----

export const selectChatList = (s: ChatState) =>
  Object.values(s.chats).sort((a, b) => b.updatedAt - a.updatedAt)

export const selectConnector = (s: ChatState, id?: string) =>
  s.connectors.find((c) => c.id === (id ?? s.selection.connectorId))
