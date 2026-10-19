import { isOwlit, type Change, type ChatMessage } from "@owlit/protocol"

// Which of a chat's changes a reply made: Owlit's entries (not undos) that name it as their reply. An
// entry that names none (recorded before entries did) is the reply's when it came from when the reply
// started until the next one did, so a change the watcher saw a moment after the reply ended is still its
// own. By name, a reply taken out of the chat (a broken one, retried) takes its entries with it rather
// than handing them to the reply before. all: the chat's entries, any order.
export function replyEntries(all: Change[], messages: ChatMessage[], messageId: string): Change[] {
  const replies = messages.filter((m) => m.role === "assistant")
  const i = replies.findIndex((m) => m.id === messageId)
  if (i < 0) return []
  const from = replies[i]!.createdAt
  const to = replies[i + 1]?.createdAt ?? Infinity
  const mine = (c: Change) => (c.origin.replyId ? c.origin.replyId === messageId : c.at >= from && c.at < to)
  return all.filter((c) => isOwlit(c.actor) && !c.undoes && mine(c)).sort((a, b) => a.at - b.at)
}

// The entry that takes this one back now: the newest undo of it that isn't itself undone. The log is
// append-only, so undone and redone are read off these links. all: newest first.
export function undoneBy(id: string, all: Change[]): Change | undefined {
  for (const c of all) if (c.undoes === id && !undoneBy(c.id, all)) return c
  return undefined
}
