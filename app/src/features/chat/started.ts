// The chats owlit started for the person (a digest, and later a thread's or a doc's work), as the thing
// each is about shows it: running, or how its last turn ended. Core is the record (chats.startedFor, then
// chats.run as each turn begins and ends); nothing here opens such a chat, which no chat list shows.

import type { ChatAbout, ChatMessage, StartedChat } from "@owlit/protocol"
import { create } from "zustand"
import { followCore } from "@/lib/follow-core"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { toastError } from "@/lib/toast"

interface StartedState {
  // The last chat about each thing, by aboutKey
  byAbout: Record<string, StartedChat>
  // Things a chat was asked for and core hasn't started yet (a paper's text is read first), by aboutKey
  asking: Record<string, true>
}

export const useStarted = create<StartedState>(() => ({ byAbout: {}, asking: {} }))

export const aboutKey = (about: ChatAbout) => `${about.kind}:${about.id}`

// Where the work on a thing stands: asked for or running, ended with a failure (its reply says why), or
// nothing to say (done, stopped by the person, or never asked)
export type StartedStand = { state: "running"; chatId?: string } | { state: "failed"; chatId: string; reply: ChatMessage } | null

export function standOf(state: StartedState, about: ChatAbout): StartedStand {
  const key = aboutKey(about)
  const chat = state.byAbout[key]
  if (chat?.reply?.status === "streaming") return { state: "running", chatId: chat.chatId }
  if (state.asking[key]) return { state: "running" }
  if (chat?.reply?.status === "error") return { state: "failed", chatId: chat.chatId, reply: chat.reply }
  return null
}

// One string per thing, so a component redraws when its stand changes rather than on every chat's turn
export function useStand(about: ChatAbout): StartedStand {
  const key = useStarted((s) => {
    const stand = standOf(s, about)
    return stand ? `${stand.state}\u0000${stand.chatId ?? ""}\u0000${stand.state === "failed" ? stand.reply.id : ""}` : ""
  })
  return key ? standOf(useStarted.getState(), about) : null
}

// A chat whose turn began or ended, or was found running
export function heardStarted(chat: StartedChat) {
  const key = aboutKey(chat.about)
  useStarted.setState((s) => {
    const { [key]: _asked, ...asking } = s.asking
    return { byAbout: { ...s.byAbout, [key]: chat }, asking }
  })
}

// Asked for: running as far as the person can tell until core starts the chat or says it won't
export function asking(about: ChatAbout, on: boolean) {
  const key = aboutKey(about)
  useStarted.setState((s) => {
    const { [key]: _was, ...rest } = s.asking
    return { asking: on ? { ...rest, [key]: true } : rest }
  })
}

// Stops the chat working on this thing
export function stopStarted(about: ChatAbout) {
  const chat = useStarted.getState().byAbout[aboutKey(about)]
  if (chat?.reply?.status !== "streaming") return
  // Without core (pnpm dev:web) the mock's chat stops here
  if (!isDesktop) heardStarted({ ...chat, reply: { ...chat.reply, status: "cancelled", finishedAt: Date.now() } })
  else void rpc.agents.cancel({ chatId: chat.chatId }).catch(toastError)
}

export function startStartedChats() {
  if (!isDesktop) return
  // Changes heard while the list is read are newer than it, so they are laid over it
  const follow = followCore({
    read: async () => {
      const [ended, running] = await Promise.all([rpc.chats.startedFor({}), rpc.agents.running()])
      // A running turn's reply is newer than the chat file's
      const live = running.flatMap((turn) => (turn.about ? [{ chatId: turn.chatId, about: turn.about, reply: turn.message }] : []))
      return [...ended.filter((c) => !live.some((l) => l.chatId === c.chatId)), ...live]
    },
    take: (list) => useStarted.setState({ byAbout: Object.fromEntries(list.map((c) => [aboutKey(c.about), c])), asking: {} }),
  })
  const load = async () => {
    useStarted.setState({ byAbout: {}, asking: {} })
    await follow.load().catch((error: unknown) => console.warn("[owlit] couldn't list the chats owlit started", error))
  }
  onNotify("chats.run", ({ chat }) => {
    if (!chat.about) return
    const about = chat.about
    const reply = chat.messages.at(-1)
    follow.hear(() => heardStarted({ chatId: chat.id, about, ...(reply?.role === "assistant" ? { reply } : {}) }))
  })
  onWorkspaceOpened(() => void load())
  if (useWorkspace.getState().current) void load()
}
