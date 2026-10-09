import { useChatStore } from "./store"
import { chatStatus, useSeenStore, type ChatStatus } from "./status"

// Where a chat stands now, for its status ring
export function useChatStatus(chatId: string): ChatStatus {
  const chat = useChatStore((s) => s.chats[chatId])
  const streaming = useChatStore((s) => !!s.streaming[chatId])
  const unseen = useSeenStore((s) => s.unseen[chatId])
  const dismissed = useSeenStore((s) => s.dismissed[chatId])
  return chat ? chatStatus(chat, streaming, unseen, dismissed) : "idle"
}
