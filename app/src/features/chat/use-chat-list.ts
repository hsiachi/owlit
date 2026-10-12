import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "./store"
import type { Chat } from "./types"

// A chat as a list shows it
export type ChatListItem = Pick<Chat, "id" | "title" | "updatedAt" | "pinned">

// The same item while its fields stay the same, so a streamed token (which changes only a chat's messages)
// redraws no list
const items = new Map<string, ChatListItem>()
function itemOf(c: Chat): ChatListItem {
  const was = items.get(c.id)
  if (was && was.title === c.title && was.updatedAt === c.updatedAt && was.pinned === c.pinned) return was
  const item = { id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: c.pinned }
  items.set(c.id, item)
  return item
}

export const useChatList = () => useChatStore(useShallow((s) => Object.values(s.chats).map(itemOf)))
