import { t } from "@lingui/core/macro"
import { useEffect } from "react"
import { create } from "zustand"
import { markSeen } from "@/app/seen"
import { countDown, countUp } from "@/lib/counts"
import { DAY } from "@/lib/time"
import type { Chat, ChatMessage, PermissionOption } from "@owlit/protocol"
import { useChatStore } from "./store"
import type { Part, ToolCall } from "./types"

// Where a chat stands, for its row in the list, its header and Home's "Waiting on you". Handed-off work
// has no list of its own: the chat list is that list, so every chat says whether something is happening.
export type ChatStatus = "idle" | "working" | "waiting" | "finished" | "failed"

// A reply that finished while the user wasn't looking at its chat keeps a mark until they open it (core
// compares the chat with the last message they saw ended, app/seen.ts); one the user stopped never gets
// one, since they did that themselves. A broken reply is not a notice but a state of the chat, read from
// the chat itself: the chat stays red until the reply is run again, and for its first days the reply also
// waits on the user (Home, the rail), so opening the chat to read the error doesn't take the problem off
// those. Nothing is dismissed: Home lists only what blocks work, and an old failure doesn't.

interface SeenState {
  // Chats on screen now (the Chat page or the docked agent window), counted since both can show one
  viewing: Record<string, number>
  // When each chat was last on screen, for this run of the app: the agent panel goes by it to tell a
  // chat the person has just left from one they left a while ago
  seenAt: Record<string, number>
  look: (chatId: string) => () => void
}

const pageShown = () => typeof document === "undefined" || document.visibilityState === "visible"

export const useSeenStore = create<SeenState>()((set) => ({
  viewing: {},
  seenAt: {},
  look: (chatId) => {
    set((s) => ({ viewing: countUp(s.viewing, chatId) }))
    return () => set((s) => ({ viewing: countDown(s.viewing, chatId), seenAt: { ...s.seenAt, [chatId]: Date.now() } }))
  },
}))

// Whether the chat is on screen now (the Chat page or the docked agent window, in a window not hidden away)
export const chatOnScreen = (chatId: string | undefined) => !!chatId && !!useSeenStore.getState().viewing[chatId] && pageShown()

// The last message of a chat the person can have seen as it ends: theirs, or a reply no longer streaming
export function lastEnded(chat: Pick<Chat, "messages"> | undefined) {
  return chat?.messages.findLast((m) => m.role === "user" || m.status !== "streaming")?.id
}

// The chat is on screen while this is mounted: each message it shows ended is seen, and coming back to the
// app with it showing counts as seeing it
export function useLookAt(chatId: string | null | undefined) {
  useEffect(() => {
    if (!chatId) return
    const stop = useSeenStore.getState().look(chatId)
    // The message last marked: a streamed token changes the chat, not which message ended last
    let marked: string | undefined
    const see = () => {
      const message = lastEnded(useChatStore.getState().chats[chatId])
      if (!message || message === marked || !pageShown()) return
      marked = message
      markSeen({ kind: "chat", id: chatId, message })
    }
    see()
    const off = useChatStore.subscribe((s, prev) => s.chats[chatId] !== prev.chats[chatId] && see())
    document.addEventListener("visibilitychange", see)
    return () => {
      stop()
      off()
      document.removeEventListener("visibilitychange", see)
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

// The chat's last reply, if it broke. One owlit cut off by closing or by opening another workspace didn't
// break: the person did that, and it says so on the reply alone.
export function brokenReply(chat: Chat): ChatMessage | undefined {
  const last = chat.messages[chat.messages.length - 1]
  return last?.role === "assistant" && last.status === "error" && !last.cutOff ? last : undefined
}

export function chatStatus(chat: Chat, streaming: boolean, unseen: boolean): ChatStatus {
  if (streaming) return pendingAsk(chat) ? "waiting" : "working"
  if (brokenReply(chat)) return "failed"
  return unseen ? "finished" : "idle"
}

// How long a broken reply waits on the user. Past it the work is taken to have moved on (the person
// asked again elsewhere, or let it go), and the chat's own red state is enough.
export const BROKEN_WAITS_DAYS = 3

// What a chat waits on the user for: a permission or a question while it runs, or a reply that broke in
// the last few days. Home's rows, the rail's Chat mark and the system notifications all go by it.
export type ChatWait = { ask: PendingAsk; broken?: undefined } | { ask?: undefined; broken: ChatMessage }

export function chatWait(chat: Chat, streaming: boolean, now = Date.now()): ChatWait | undefined {
  if (streaming) {
    const ask = pendingAsk(chat)
    return ask && { ask }
  }
  const broken = brokenReply(chat)
  return broken && now - broken.createdAt < BROKEN_WAITS_DAYS * DAY ? { broken } : undefined
}

// Getters, so each word is said in the interface's language when read rather than once on import
export const STATUS_LABEL: Record<ChatStatus, string> = {
  idle: "",
  get working() {
    return t({ message: "Working", comment: "a chat's status: its agent is at work" })
  },
  get waiting() {
    return t`Waiting on you`
  },
  get finished() {
    return t`Finished since you last looked`
  },
  get failed() {
    return t`Stopped with an error`
  },
}
