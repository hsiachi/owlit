import { useEffect } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { countDown, countUp } from "@/lib/counts"
import type { Chat, ChatMessage, Part, PermissionOption, ToolCall } from "./types"

// Where a chat stands, for its row in the list, its header and Home's "Waiting on you". Handed-off work
// has no list of its own: the chat list is that list, so every chat says whether something is happening.
export type ChatStatus = "idle" | "working" | "waiting" | "finished" | "failed"

// A reply that finished while the user wasn't looking at its chat keeps a mark until they open it; one the
// user stopped never gets one, since they did that themselves. A broken reply is not a notice but a state
// of the chat, read from the chat itself: it stays until the reply is run again or the user dismisses it,
// so opening the chat to read the error doesn't take the problem off the list, the rail and Home.
type Unseen = "finished"

interface SeenState {
  unseen: Record<string, Unseen>
  // The broken reply the user chose to leave as it is, per chat (its message id)
  dismissed: Record<string, string>
  // Chats on screen now (the Chat page or the docked agent window), counted since both can show one
  viewing: Record<string, number>
  ended: (chatId: string, how: "finished" | "failed" | "cancelled") => void
  look: (chatId: string) => () => void
  forget: (chatId: string) => void
  dismiss: (chatId: string, messageId: string) => void
}

const pageShown = () => typeof document === "undefined" || document.visibilityState === "visible"

export const useSeenStore = create<SeenState>()(
  persist(
    (set) => ({
      unseen: {},
      dismissed: {},
      viewing: {},
      ended: (chatId, how) => {
        if (how !== "finished" || chatOnScreen(chatId)) return
        set((s) => ({ unseen: { ...s.unseen, [chatId]: how } }))
      },
      look: (chatId) => {
        set((s) => {
          const { [chatId]: _seen, ...unseen } = s.unseen
          return { viewing: countUp(s.viewing, chatId), unseen }
        })
        return () => set((s) => ({ viewing: countDown(s.viewing, chatId) }))
      },
      forget: (chatId) =>
        set((s) => {
          const { [chatId]: _gone, ...unseen } = s.unseen
          return { unseen }
        }),
      dismiss: (chatId, messageId) => set((s) => ({ dismissed: { ...s.dismissed, [chatId]: messageId } })),
    }),
    // What is unseen or dismissed outlives a reload; what is on screen is worked out again. Marks saved
    // as "failed" by earlier builds are dropped, since a broken reply is now read from the chat.
    {
      name: "owlit.chat-seen",
      partialize: (s) => ({ unseen: s.unseen, dismissed: s.dismissed }),
      merge: (saved, current) => {
        const { unseen = {}, dismissed = {} } = (saved ?? {}) as { unseen?: Record<string, string>; dismissed?: Record<string, string> }
        const finished = Object.fromEntries(Object.entries(unseen).filter(([, how]) => how === "finished")) as Record<string, Unseen>
        return { ...current, unseen: finished, dismissed }
      },
    },
  ),
)

// Whether the chat is on screen now (the Chat page or the docked agent window, in a window not hidden away)
export const chatOnScreen = (chatId: string | undefined) => !!chatId && !!useSeenStore.getState().viewing[chatId] && pageShown()

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

// What the last reply waits on the user for: a permission, or a question of the agent's
export type PendingAsk = Part<"permission"> | Part<"question">
export function pendingAsk(chat: Chat): PendingAsk | undefined {
  const last = chat.messages[chat.messages.length - 1]
  if (last?.role !== "assistant" || last.status !== "streaming") return undefined
  return last.parts.find((p): p is PendingAsk => (p.type === "permission" || p.type === "question") && !p.outcome)
}

// The tool call a request of the last reply is about
export const callOf = (chat: Chat, toolCallId: string | undefined) =>
  chat.messages.at(-1)?.parts.find((p): p is ToolCall => p.type === "tool_call" && p.toolCallId === toolCallId)

// The option of a permission that allows (or refuses) once, or the nearest one the agent offers
export const optionFor = (options: PermissionOption[], allow: boolean) =>
  options.find((o) => o.kind === (allow ? "allow_once" : "reject_once")) ?? options.find((o) => o.kind.startsWith(allow ? "allow" : "reject"))

// The chat's last reply, if it broke and the user hasn't dismissed it
export function brokenReply(chat: Chat, dismissed: string | undefined): ChatMessage | undefined {
  const last = chat.messages[chat.messages.length - 1]
  return last?.role === "assistant" && last.status === "error" && last.id !== dismissed ? last : undefined
}

// The chat's broken reply, with a way to leave it as it is, while it still asks for the user
export function useBrokenReply(chat: Chat | undefined) {
  const dismissed = useSeenStore((s) => (chat ? s.dismissed[chat.id] : undefined))
  const broken = chat ? brokenReply(chat, dismissed) : undefined
  if (!chat || !broken) return undefined
  return { messageId: broken.id, dismiss: () => useSeenStore.getState().dismiss(chat.id, broken.id) }
}

export function chatStatus(chat: Chat, streaming: boolean, unseen: Unseen | undefined, dismissed: string | undefined): ChatStatus {
  if (streaming) return pendingAsk(chat) ? "waiting" : "working"
  if (brokenReply(chat, dismissed)) return "failed"
  return unseen ?? "idle"
}

// Whether any chat needs the user (a permission, or a broken reply left as it is): the Chat place's rail mark
export function chatsNeedYou(chats: Record<string, Chat>, streaming: Record<string, unknown>, dismissed: Record<string, string>) {
  return Object.values(chats).some((c) => (streaming[c.id] && pendingAsk(c)) || brokenReply(c, dismissed[c.id]))
}

export const STATUS_LABEL: Record<ChatStatus, string> = {
  idle: "",
  working: "Working",
  waiting: "Waiting on you",
  finished: "Finished since you last looked",
  failed: "Stopped with an error",
}
