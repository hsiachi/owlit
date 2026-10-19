// The chats owlit started for the person (a digest, a thread's work, and later a doc's), as the thing
// each is about shows it: running, or how its last turn ended. Core is the record (chats.startedFor, then
// chats.turn as each turn begins and ends); nothing here opens such a chat, which no chat list shows.

import { t } from "@lingui/core/macro"
import type { ChatAbout, ChatMessage, StartedChat } from "@owlit/protocol"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { followCore } from "@/lib/follow-core"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { toastError } from "@/lib/toast"

interface StartedState {
  // The last chat about each thing, by aboutKey
  byAbout: Record<string, StartedChat>
  // Every chat whose turn runs now, by chat id: several can work on one thing at once (a thread)
  running: Record<string, StartedChat>
  // Things a chat was asked for and core hasn't started yet (a paper's text is read first), by aboutKey
  asking: Record<string, true>
}

export const useStarted = create<StartedState>(() => ({ byAbout: {}, running: {}, asking: {} }))

export const aboutKey = (about: ChatAbout) => `${about.kind}:${about.id}`

// Where the work on a thing stands: asked for or running, ended with a failure (its reply says why), or
// nothing to say (done, stopped by the person, or never asked)
export type StartedStand = { state: "running"; chatId?: string } | { state: "failed"; chatId: string; reply: ChatMessage } | null

export function standOf(state: StartedState, about: ChatAbout): StartedStand {
  const key = aboutKey(about)
  const chat = state.byAbout[key]
  const live = runningOf(state, about)[0]
  if (live) return { state: "running", chatId: live.chatId }
  if (state.asking[key]) return { state: "running" }
  if (chat?.reply?.status === "error") return { state: "failed", chatId: chat.chatId, reply: chat.reply }
  return null
}

// The chats working on a thing now, the earliest first
export function runningOf(state: StartedState, about: ChatAbout): StartedChat[] {
  const key = aboutKey(about)
  return Object.values(state.running)
    .filter((c) => aboutKey(c.about) === key)
    .sort((a, b) => (a.reply?.createdAt ?? 0) - (b.reply?.createdAt ?? 0))
}

export function useRunning(about: ChatAbout): StartedChat[] {
  return useStarted(useShallow((s) => runningOf(s, about)))
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
    const { [chat.chatId]: _was, ...running } = s.running
    return { byAbout: { ...s.byAbout, [key]: chat }, running: chat.reply?.status === "streaming" ? { ...running, [chat.chatId]: chat } : running, asking }
  })
}

// Work core couldn't start a chat for after answering that it would (chats.notStarted): failed, with the
// sentence that says why. It has no chat, so its Retry asks for the work again rather than a new turn.
export function notStarted(about: ChatAbout, error: string) {
  const now = Date.now()
  heardStarted({ chatId: "", about, reply: { id: `not-started-${now}`, role: "assistant", parts: [], createdAt: now, finishedAt: now, status: "error", error } })
}

// Asked for: running as far as the person can tell until core starts the chat or says it won't
export function asking(about: ChatAbout, on: boolean) {
  const key = aboutKey(about)
  useStarted.setState((s) => {
    const { [key]: _was, ...rest } = s.asking
    return { asking: on ? { ...rest, [key]: true } : rest }
  })
}

// Stops the chat working on this thing (the earliest, when several are)
export function stopStarted(about: ChatAbout) {
  const chat = runningOf(useStarted.getState(), about)[0]
  if (chat) stopChat(chat)
}

export function stopChat(chat: StartedChat) {
  if (chat.reply?.status !== "streaming") return
  // Without core (pnpm dev:web) the mock's chat stops here
  if (!isDesktop) heardStarted({ ...chat, reply: { ...chat.reply, status: "cancelled", finishedAt: Date.now() } })
  else void rpc.agents.cancel({ chatId: chat.chatId }).catch(toastError)
}

// Retry: another turn in the chat that broke, so its agent sees what it did before
export async function tryAgain(chatId: string) {
  const chat = Object.values(useStarted.getState().byAbout).find((c) => c.chatId === chatId)
  if (!isDesktop) return void (chat && mockStarted(chat.about, chatId))
  await rpc.chats.tryAgain({ chatId }).catch(toastError)
}

// Without core (pnpm dev:web) work asked for runs a few seconds and is then cut off, so both the line
// that says it is under way and the one that says why it stopped can be seen
export function mockStarted(about: ChatAbout, chatId = `mock-${aboutKey(about)}-${Date.now()}`) {
  const reply = { id: `${chatId}-${Date.now()}`, role: "assistant" as const, parts: [], createdAt: Date.now() }
  heardStarted({ chatId, about, reply: { ...reply, status: "streaming" } })
  setTimeout(() => {
    if (useStarted.getState().running[chatId]?.reply?.id !== reply.id) return
    heardStarted({ chatId, about, reply: { ...reply, status: "error", error: t`Owlit was closed before it finished.`, cutOff: "closed", finishedAt: Date.now() } })
  }, MOCK_RUN_MS)
}

const MOCK_RUN_MS = 4000

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
    take: (list) =>
      useStarted.setState({
        byAbout: Object.fromEntries(list.map((c) => [aboutKey(c.about), c])),
        running: Object.fromEntries(list.filter((c) => c.reply?.status === "streaming").map((c) => [c.chatId, c])),
        asking: {},
      }),
  })
  const load = async () => {
    useStarted.setState({ byAbout: {}, running: {}, asking: {} })
    await follow.load().catch((error: unknown) => console.warn("[owlit] couldn't list the chats owlit started", error))
  }
  onNotify("chats.notStarted", ({ about, error }) => follow.hear(() => notStarted(about, error)))
  onNotify("chats.turn", ({ chat }) => {
    if (!chat.about) return
    const about = chat.about
    const reply = chat.messages.at(-1)
    follow.hear(() => heardStarted({ chatId: chat.id, about, ...(reply?.role === "assistant" ? { reply } : {}) }))
  })
  onWorkspaceOpened(() => void load())
  if (useWorkspace.getState().current) void load()
}
