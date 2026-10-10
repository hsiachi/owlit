import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useChatStore } from "@/features/chat/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import type { Mentionable, PromptInput, QuotedSelection } from "@/features/chat/types"
import type { PageRect } from "@/features/library/types"

// The app-wide agent window. It is closed, a small ask bar, or a panel docked on the right. Its
// conversations are ordinary chats. The ask bar is for a new question (⌘J); the panel shows the current
// chat (⇧⌘J), which is whichever chat the user last looked at, here or on the Chat page: the two are one
// conversation at two sizes, so a chat started in Chat can sit beside the doc it is about.
export type AgentStage = "closed" | "bar" | "open"

interface AgentWindowState {
  stage: AgentStage
  // The current chat, shown when the panel is open
  chatId: string | null
  // A passage sent with the next message; used once
  selection: QuotedSelection | null
  // Where that passage sits in a paper's PDF, when it came from there: the page keeps drawing it as a
  // selection while its chip waits, so the user still sees what the question is about
  selectionRects: { paperId: string; rects: PageRect[] } | null
  // The paper note this conversation started from, if it did: on that paper's page the details panel
  // (where the note is) stays open beside the window, so an edit Owlit proposes is seen where it lands
  fromNote: string | null
  // The page chip the user removed, by uri; it comes back on another page
  hiddenContext: string | null
  // The list panel shown again by hand while the panel is docked
  listShown: boolean
  // Bumped to put the cursor in the window's input
  focusTick: number
  // The ask bar's placeholder when it was opened for something particular (Help › Ask Owlit How To…)
  hint: string | null

  // Ask Owlit (⌘J, or on a selection): into the panel when it is open, else the ask bar for a new chat
  open: (selection?: QuotedSelection, rects?: { paperId: string; rects: PageRect[] }) => void
  close: () => void
  // ⌘J: the ask bar, or the cursor into the panel's input when the panel is open
  toggle: () => void
  // ⇧⌘J and the top bar's button: the panel with the current chat, or closed
  togglePanel: () => void
  // The Chat page is showing this chat, which makes it the current one
  follow: (chatId: string) => void
  newChat: () => void
  // A new conversation about using owlit itself
  askHowTo: () => void
  showChat: (chatId: string) => void
  hideContext: (uri: string) => void
  clearSelection: () => void
  setListShown: (shown: boolean) => void
  // Sends from the window: the ask bar starts a chat, the panel adds to the current one (or starts one
  // when there is none); either way the panel shows it
  send: (input: PromptInput, context: Mentionable[]) => void
}

export const useAgentWindow = create<AgentWindowState>()(
  persist(
    (set, get) => ({
      stage: "closed",
      chatId: null,
      selection: null,
      selectionRects: null,
      fromNote: null,
      hiddenContext: null,
      listShown: false,
      focusTick: 0,
      hint: null,

      open: (selection, rects) =>
        set((s) => ({
          stage: s.stage === "open" ? "open" : "bar",
          selection: selection ?? s.selection,
          selectionRects: selection ? (rects ?? null) : s.selectionRects,
          fromNote: selection ? (selection.notePath ?? null) : s.fromNote,
          focusTick: s.focusTick + 1,
        })),
      close: () => set({ stage: "closed", listShown: false, fromNote: null, hint: null }),
      toggle: () => (get().stage === "bar" ? get().close() : get().open()),
      togglePanel: () =>
        get().stage === "open" ? get().close() : set((s) => ({ stage: "open", fromNote: null, hint: null, focusTick: s.focusTick + 1 })),
      follow: (chatId) => set((s) => (s.chatId === chatId ? s : { chatId, fromNote: null })),
      // The ask bar always starts a chat, so the current one stays for ⇧⌘J to come back to
      newChat: () => set((s) => ({ stage: "bar", selection: null, fromNote: null, hiddenContext: null, hint: null, focusTick: s.focusTick + 1 })),
      askHowTo: () =>
        set((s) => ({ stage: "bar", selection: null, fromNote: null, hiddenContext: null, hint: "How do I… (about owlit)", focusTick: s.focusTick + 1 })),
      showChat: (chatId) => set((s) => ({ chatId, stage: "open", fromNote: chatId === s.chatId ? s.fromNote : null, focusTick: s.focusTick + 1 })),
      hideContext: (uri) => set({ hiddenContext: uri }),
      clearSelection: () => set({ selection: null }),
      setListShown: (listShown) => set({ listShown }),

      send: (input, context) => {
        const chats = useChatStore.getState()
        const { chatId, selection, stage } = get()
        const chat = stage === "open" && chatId && chats.chats[chatId] ? chats.chats[chatId] : chats.createChat()
        set({ chatId: chat.id, stage: "open", selection: null, hint: null })
        void chats.send(chat.id, { ...input, context, selection: selection ?? undefined })
      },
    }),
    // Only the current chat is kept, so ⇧⌘J after a reload picks it up again; the window starts closed.
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
