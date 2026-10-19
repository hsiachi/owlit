import { t } from "@lingui/core/macro"
import type { ChatAbout, ChatMessage, StartedChat, Thread, ThreadSize } from "@owlit/protocol"
import { toast } from "sonner"
import { mockStarted, useRunning, useStand } from "@/features/chat/started"
import { isDesktop, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { put } from "./store"

// Owlit's work on a thread: each button starts a chat owlit starts about the thread (core's threads.ts),
// read here by what it is about (features/chat/started.ts): the chats at work now, several at once, and
// the last one's failure while none works, said where the user looks

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

// What a chat is doing on the thread, as a line on the page, from the recipe it was started with; a
// column's question names the column
export function workWords(chat: StartedChat, c: Thread | undefined): string {
  const column = c?.columns.find((col) => col.id === chat.about.column)
  const question = column?.question ?? ""
  switch (chat.about.recipe) {
    case "gather":
      return t`Gathering papers…`
    case "find-more":
      return t`Finding more papers…`
    case "ask-each":
      return column ? t`Asking each paper “${question}”…` : t`Asking each paper…`
    case "group":
      return column ? t`Grouping the papers by “${question}”…` : t`Grouping the papers…`
    case "read-in-full":
      return t`Reading papers in full…`
    default:
      return t`Owlit is working on this thread…`
  }
}

// Without core (pnpm dev:web) the work runs a few seconds and is then cut off (started.ts)
const mock = (id: string, recipe: string, column?: string) => mockStarted({ kind: "thread", id, recipe, ...(column ? { column } : {}) })

export async function gather(question: string, size: ThreadSize, project: string): Promise<Thread | undefined> {
  if (!isDesktop) {
    toast(t`Owlit gathers papers in the desktop app.`)
    return undefined
  }
  try {
    const { thread } = await rpc.threads.gather({ question, size, ...(project ? { project } : {}) })
    put(thread)
    return thread
  } catch (error) {
    toastError(error)
    return undefined
  }
}

// what: for more, what to look for this time
export async function startWork(id: string, work: "more" | "read", what?: string) {
  if (!isDesktop) return mock(id, work === "more" ? "find-more" : "read-in-full")
  await rpc.threads.start({ id, work, ...(what ? { what } : {}) }).catch(toastError)
}

// Group another way: a new grouping Owlit works out; the thread with it
export async function groupAnotherWay(id: string, question: string): Promise<Thread | undefined> {
  if (!isDesktop) return void mock(id, "group")
  try {
    const { thread } = await rpc.threads.group({ id, question })
    put(thread)
    return thread
  } catch (error) {
    toastError(error)
    return undefined
  }
}

export async function askEach(id: string, question: string) {
  if (!isDesktop) return mock(id, "ask-each")
  try {
    put((await rpc.threads.ask({ id, question })).thread)
  } catch (error) {
    toastError(error)
  }
}

// Ask again: fills what a column still lacks; the answers there stay, and the user's own whatever happens
export async function askAgain(id: string, column: string) {
  if (!isDesktop) return mock(id, "ask-each", column)
  await rpc.threads.fill({ id, column }).catch(toastError)
}

// What the browser preview says when asked for work only core does
export const desktopOnly = () => void toast(t`Owlit works on threads in the desktop app.`)
