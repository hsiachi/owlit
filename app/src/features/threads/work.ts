import { t } from "@lingui/core/macro"
import type { ChatAbout, ChatMessage, StartedChat } from "@owlit/protocol"
import { useRunning, useStand } from "@/features/chat/started"

// Chats owlit started about a thread, read by what they are about (features/chat/started.ts): the chats
// at work on it now, several at once, and the last one's failure while none works, said where the user
// looks

const threadAbout = (id: string): ChatAbout => ({ kind: "thread", id })

export interface ThreadWork {
  // The earliest first, so the line a thread shows stays put while others start
  running: StartedChat[]
  // The last chat that broke, while none works: its reply says why
  failed?: { chatId: string; reply: ChatMessage }
}

export function useThreadWork(id: string): ThreadWork {
  const about = threadAbout(id)
  const running = useRunning(about)
  const stand = useStand(about)
  return { running, ...(stand?.state === "failed" ? { failed: { chatId: stand.chatId, reply: stand.reply } } : {}) }
}

// What a chat is doing on the thread, as a line on the page. Thread work is a chat the user typed into,
// so the line names no particular job.
export const workWords = () => t`Owlit is working on this thread…`
