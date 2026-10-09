import { useChatStore } from "../store"

// Sends again the user message that came before an assistant reply: Regenerate, and Retry on a reply
// that broke
export function regenerate(chatId: string, index: number) {
  const { chats, send } = useChatStore.getState()
  const chat = chats[chatId]
  if (!chat) return
  const prev = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === "user")
  if (!prev) return
  const text = prev.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")
  void send(chatId, { text, mentions: prev.mentions ?? [], attachments: prev.attachments ?? [], context: prev.context, selection: prev.selection })
}
