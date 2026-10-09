import { useEffect } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Chat, MessagePart } from "./types"

// Where a chat stands, for its row in the list, its header and Home's "Waiting on you". Handed-off work
// has no list of its own: the chat list is that list, so every chat says whether something is happening.
export type ChatStatus = "idle" | "working" | "waiting" | "finished" | "failed"

// What ended while the user wasn't looking at the chat: it keeps its mark until they open it. A reply the
// user stopped never gets one, since they did that themselves.
type Unseen = "finished" | "failed"

interface SeenState {
  unseen: Record<string, Unseen>
  // Chats on screen now (the Chat page or the docked agent window), counted since both can show one
  viewing: Record<string, number>
  ended: (chatId: string, how: Unseen | "cancelled") => void
  look: (chatId: string) => () => void
  forget: (chatId: string) => void
}

const pageShown = () => typeof document === "undefined" || document.visibilityState === "visible"

export const useSeenStore = create<SeenState>()(
  persist(
    (set, get) => ({
      unseen: {},
      viewing: {},
      ended: (chatId, how) => {
        if (how === "cancelled" || (get().viewing[chatId] && pageShown())) return
        set((s) => ({ unseen: { ...s.unseen, [chatId]: how } }))
      },
      look: (chatId) => {
        set((s) => {
          const { [chatId]: _seen, ...unseen } = s.unseen
          return { viewing: { ...s.viewing, [chatId]: (s.viewing[chatId] ?? 0) + 1 }, unseen }
        })
        return () =>
          set((s) => {
            const n = (s.viewing[chatId] ?? 1) - 1
            const { [chatId]: _gone, ...viewing } = s.viewing
            return { viewing: n > 0 ? { ...viewing, [chatId]: n } : viewing }
          })
      },
      forget: (chatId) =>
        set((s) => {
          const { [chatId]: _gone, ...unseen } = s.unseen
          return { unseen }
        }),
    }),
    // Only what is still unseen outlives a reload; what is on screen is worked out again
    { name: "owlit.chat-seen", partialize: (s) => ({ unseen: s.unseen }) },
  ),
)

// The chat is on screen while this is mounted; coming back to the app with it showing counts as seeing it
export function useLookAt(chatId: string | null | undefined) {
  useEffect(() => {
    if (!chatId) return
    const stop = useSeenStore.getState().look(chatId)
    const onShow = () => pageShown() && useSeenStore.getState().forget(chatId)
    document.addEventListener("visibilitychange", onShow)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onShow)
    }
  }, [chatId])
}

// A permission the last reply is waiting on, if any
export function pendingPermission(chat: Chat): Extract<MessagePart, { type: "permission" }> | undefined {
  const last = chat.messages[chat.messages.length - 1]
  if (last?.role !== "assistant" || last.status !== "streaming") return undefined
  return last.parts.find((p): p is Extract<MessagePart, { type: "permission" }> => p.type === "permission" && !p.outcome)
}

export function chatStatus(chat: Chat, streaming: boolean, unseen: Unseen | undefined): ChatStatus {
  if (streaming) return pendingPermission(chat) ? "waiting" : "working"
  return unseen ?? "idle"
}

export const STATUS_LABEL: Record<ChatStatus, string> = {
  idle: "",
  working: "Working",
  waiting: "Waiting for you",
  finished: "Finished since you last looked",
  failed: "Stopped with an error",
}
