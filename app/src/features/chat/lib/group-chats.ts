import { t } from "@lingui/core/macro"
import { DAY, startOfDay } from "@/lib/time"
import type { ChatListItem } from "../use-chat-list"

type Bucket = "pinned" | "today" | "yesterday" | "week" | "month" | "older"

export interface ChatGroup {
  id: Bucket
  label: string
  chats: ChatListItem[]
}

const labelOf = (bucket: Bucket) =>
  ({
    pinned: t({ message: "Pinned", comment: "heading over pinned chats" }),
    today: t`Today`,
    yesterday: t`Yesterday`,
    week: t`Previous 7 days`,
    month: t`Previous 30 days`,
    older: t({ message: "Older", comment: "heading over chats older than 30 days" }),
  })[bucket]

// Pinned first, then by recency buckets like most chat apps
export function groupChats(chats: ChatListItem[], now = Date.now()): ChatGroup[] {
  const today = startOfDay(now)
  const buckets: Record<Bucket, ChatListItem[]> = { pinned: [], today: [], yesterday: [], week: [], month: [], older: [] }
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (c.pinned) {
      buckets.pinned.push(c)
      continue
    }
    const d = startOfDay(c.updatedAt)
    if (d >= today) buckets.today.push(c)
    else if (d >= today - DAY) buckets.yesterday.push(c)
    else if (d >= today - 7 * DAY) buckets.week.push(c)
    else if (d >= today - 30 * DAY) buckets.month.push(c)
    else buckets.older.push(c)
  }
  return (Object.entries(buckets) as [Bucket, ChatListItem[]][])
    .filter(([, list]) => list.length > 0)
    .map(([id, list]) => ({ id, label: labelOf(id), chats: list }))
}
