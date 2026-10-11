import { useChatStore } from "../store"
import { messageText } from "./message-text"

// Sends again the user message that came before an assistant reply: Regenerate, and Retry on a reply
// that broke. A broken reply is replaced, with the question it answered, so retrying doesn't leave the
// same question and the same error in the chat again and again.
export function regenerate(chatId: string, index: number) {
  const { chats, send, removeMessages } = useChatStore.getState()
  const chat = chats[chatId]
  if (!chat) return
  const prev = [...chat.messages.slice(0, index)].reverse().find((m) => m.role === "user")
  if (!prev) return
  const reply = chat.messages[index]
  if (reply?.role === "assistant" && reply.status === "error") removeMessages(chatId, [prev.id, reply.id])
  const text = messageText(prev, "\n")
  void send(chatId, { text, mentions: prev.mentions ?? [], attachments: prev.attachments ?? [], context: prev.context, selection: prev.selection })
}
