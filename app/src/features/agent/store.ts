import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useChatStore } from "@/features/chat/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import type { Mentionable, PromptInput, QuotedSelection } from "@/features/chat/types"

// The app-wide agent window. It is closed, a small ask bar, or a panel docked on the right. Its
// conversations are ordinary chats; the window only remembers which one it is showing.
export type AgentStage = "closed" | "bar" | "open"

interface AgentWindowState {
  stage: AgentStage
  chatId: string | null
  // A passage sent with the next message; used once
  selection: QuotedSelection | null
  // The paper note this conversation started from, if it did: on that paper's page the details panel
  // (where the note is) stays open beside the window, so an edit Owlit proposes is seen where it lands
  fromNote: string | null
  // The page chip the user removed, by uri; it comes back on another page
  hiddenContext: string | null
  // The list panel shown again by hand while the panel is docked
  listShown: boolean
  // Bumped to put the cursor in the window's input
  focusTick: number

  // Opens the window: the ask bar for a new conversation, the panel when one is going
  open: (selection?: QuotedSelection) => void
  close: () => void
  toggle: () => void
  newChat: () => void
  showChat: (chatId: string) => void
  hideContext: (uri: string) => void
  clearSelection: () => void
  setListShown: (shown: boolean) => void
  // Sends from the window, starting a chat if there is none; the panel takes over from the bar
  send: (input: PromptInput, context: Mentionable[]) => void
}

const hasMessages = (chatId: string | null) => !!chatId && (useChatStore.getState().chats[chatId]?.messages.length ?? 0) > 0

export const useAgentWindow = create<AgentWindowState>()(
  persist(
    (set, get) => ({
      stage: "closed",
      chatId: null,
      selection: null,
      fromNote: null,
      hiddenContext: null,
      listShown: false,
      focusTick: 0,

      open: (selection) =>
        set((s) => ({
          stage: s.stage === "open" || hasMessages(s.chatId) ? "open" : "bar",
          selection: selection ?? s.selection,
          fromNote: selection ? (selection.notePath ?? null) : s.fromNote,
          focusTick: s.focusTick + 1,
        })),
      close: () => set({ stage: "closed", listShown: false, fromNote: null }),
      toggle: () => (get().stage === "closed" ? get().open() : get().close()),
      newChat: () => set((s) => ({ chatId: null, stage: "bar", selection: null, fromNote: null, hiddenContext: null, focusTick: s.focusTick + 1 })),
      showChat: (chatId) => set((s) => ({ chatId, stage: "open", fromNote: chatId === s.chatId ? s.fromNote : null, focusTick: s.focusTick + 1 })),
      hideContext: (uri) => set({ hiddenContext: uri }),
      clearSelection: () => set({ selection: null }),
      setListShown: (listShown) => set({ listShown }),

      send: (input, context) => {
        const chats = useChatStore.getState()
        const { chatId, selection } = get()
        const chat = chatId && chats.chats[chatId] ? chats.chats[chatId] : chats.createChat()
        set({ chatId: chat.id, stage: "open", selection: null })
        void chats.send(chat.id, { ...input, context, selection: selection ?? undefined })
      },
    }),
    // Only the conversation is kept, so ⌘J after a reload picks it up again; the window starts closed.
    // In the desktop app it is kept with the workspace instead (workspace.json's layout).
    { name: "owlit-agent-window", partialize: (s) => (isDesktop ? {} : { chatId: s.chatId }) },
  ),
)

if (isDesktop) {
  // Set while the window takes the workspace's saved chat, which needs no saving back
  let restoring = false
  const restore = (chatId: string | null) => {
    restoring = true
    useAgentWindow.setState({ chatId })
    restoring = false
  }
  onWorkspaceOpened(() => {
    restore(null)
    useAgentWindow.setState({ stage: "closed" })
    rpc.workspace
      .layout()
      .then((layout) => restore(typeof layout.agentChatId === "string" ? layout.agentChatId : null))
      .catch(() => undefined)
  })
  useAgentWindow.subscribe((state, prev) => {
    if (restoring || state.chatId === prev.chatId || !useWorkspace.getState().current) return
    rpc.workspace.setLayout({ patch: { agentChatId: state.chatId } }).catch(() => undefined)
  })
}
