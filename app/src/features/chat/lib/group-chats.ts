import { DAY, startOfDay } from "@/lib/time"
import type { Chat } from "../types"

export interface ChatGroup {
  label: string
  chats: Chat[]
}


// Pinned first, then by recency buckets like most chat apps
export function groupChats(chats: Chat[], now = Date.now()): ChatGroup[] {
  const today = startOfDay(now)
  const buckets: Record<string, Chat[]> = { Pinned: [], Today: [], Yesterday: [], "Previous 7 days": [], "Previous 30 days": [], Older: [] }
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (c.pinned) {
      buckets.Pinned.push(c)
      continue
    }
    const d = startOfDay(c.updatedAt)
    if (d >= today) buckets.Today.push(c)
    else if (d >= today - DAY) buckets.Yesterday.push(c)
    else if (d >= today - 7 * DAY) buckets["Previous 7 days"].push(c)
    else if (d >= today - 30 * DAY) buckets["Previous 30 days"].push(c)
    else buckets.Older.push(c)
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, chats: list }))
}
