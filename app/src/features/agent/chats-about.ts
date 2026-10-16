import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/features/chat/store"
import type { ChatMessage } from "@owlit/protocol"

// What a chat's questions were about: the page each was asked beside, the papers and docs it mentioned, and
// where a quoted passage came from. Kept per messages array, so a streamed token (a new array for one chat)
// works out only that chat again.
const aboutOf = new WeakMap<ChatMessage[], Set<string>>()
function about(messages: ChatMessage[]) {
  let uris = aboutOf.get(messages)
  if (uris) return uris
  uris = new Set()
  for (const m of messages) {
    if (m.role !== "user") continue
    for (const x of m.context ?? []) uris.add(x.uri)
    for (const x of m.mentions ?? []) uris.add(x.uri)
    if (m.selection) uris.add(m.selection.source.uri)
  }
  aboutOf.set(messages, uris)
  return uris
}

// The latest chats with a question about this page, newest first, by id
export function useChatsAbout(uri: string | undefined, max = 3) {
  return useChatStore(
    useShallow((s) => {
      if (!uri) return []
      return Object.values(s.chats)
        .filter((c) => about(c.messages).has(uri))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, max)
        .map((c) => c.id)
    }),
  )
}
