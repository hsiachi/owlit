import type { ChatMessage } from "@owlit/protocol"

// What a message says in words: its text parts, joined by `sep`
export const messageText = (m: Pick<ChatMessage, "parts">, sep = "\n\n") => m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(sep)
