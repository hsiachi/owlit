import { useChatStore } from "./store"
import { useChatUnseen } from "@/app/seen"
import { chatStatus, type ChatStatus } from "./status"

// Where a chat stands now, for its status ring; selected as the status itself, so its row is drawn again
// only when that changes, not on every streamed token
export function useChatStatus(chatId: string): ChatStatus {
  const unseen = useChatUnseen(chatId)
  return useChatStore((s) => {
    const chat = s.chats[chatId]
    return chat ? chatStatus(chat, !!s.streaming[chatId], unseen) : "idle"
  })
}
