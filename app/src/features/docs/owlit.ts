// Owlit and each doc, as core keeps it (.owlit/docs/owlit.json): whether the user keeps Owlit out of it.
// Read when a doc's header shows, kept current by docs.owlit. And Owlit going through a doc, in a chat
// owlit starts about it (features/chat/started.ts).

import { t } from "@lingui/core/macro"
import { isOpenComment, isOwlit, type ChatAbout, type DocOwlit } from "@owlit/protocol"
import { useEffect } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { unseenComments, useSeen } from "@/app/seen"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toast } from "sonner"
import { toastError } from "@/lib/toast"
import { onWorkspaceOpened } from "@/lib/workspace"
import { aboutKey, asking, heardStarted, standOf, stopStarted, useStand, useStarted, type StartedStand } from "@/features/chat/started"
import { useDocsStore } from "./store"
import { displayName } from "./types"

interface DocOwlitState {
  byPath: Record<string, DocOwlit>
}

export const useDocOwlitStore = create<DocOwlitState>(() => ({ byPath: {} }))

const put = (path: string, state: DocOwlit) => useDocOwlitStore.setState((s) => ({ byPath: { ...s.byPath, [path]: state } }))

// A doc's entry, read from core the first time it is asked for (and again after a rename, under its new path)
export function useDocOwlit(path: string): DocOwlit | undefined {
  const state = useDocOwlitStore((s) => s.byPath[path])
  useEffect(() => {
    if (!isDesktop || useDocOwlitStore.getState().byPath[path]) return
    rpc.docs.owlit({ path }).then((got) => put(path, got), () => undefined)
  }, [path])
  return state
}

// Owlit's open comments on a doc that came after the user last saw its comments, oldest first: they carry
// Owlit's dot on the chip and the doc's row until they have been on screen a moment
export function useNewOwlitComments(file: { id: string; path: string } | undefined) {
  const unseen = useSeen(useShallow((s) => (file ? unseenComments(s.unseen, file.path) : [])))
  return useDocsStore(
    useShallow((s) =>
      (file ? (s.comments[file.id] ?? []) : [])
        .filter((c) => isOpenComment(c) && !!c.entries[0] && isOwlit(c.entries[0].by) && unseen.includes(c.id))
        .sort((a, b) => a.createdAt - b.createdAt),
    ),
  )
}

const goThroughAbout = (path: string): ChatAbout => ({ kind: "doc", id: path })

// Where Owlit going through this doc stands: running, stopped with why (the reply's sentence, kept by
// core, so after a restart too), or nothing. Read when the doc's menu opens.
export function goingThrough(path: string): StartedStand {
  return standOf(useStarted.getState(), goThroughAbout(path))
}

// The same, for a component that shows it (a row whose menu is built as it draws)
export function useGoingThrough(path: string): StartedStand {
  return useStand(goThroughAbout(path))
}

export function stopGoingThrough(path: string) {
  stopStarted(goThroughAbout(path))
}

// Owlit goes through this doc as material from people (a meeting's transcript, reviews) against the
// user's other docs: its reading lands as a record beside it, its points as comments. While it works, the
// doc's ⋯ menu says so and offers Stop; when it broke, the menu says why and offers Retry, which asks
// again (core makes that a new turn in the chat that broke).
export function goThrough(file: { path: string }, { retry = false } = {}) {
  const about = goThroughAbout(file.path)
  const name = displayName(file.path)
  const started = () => {
    if (!retry) toast(t`Owlit is going through “${name}”`, { description: t`What it finds will come as comments. The doc's menu can stop it.` })
  }
  if (!isDesktop) {
    mockGoThrough(about)
    return started()
  }
  asking(about, true)
  rpc.docs.goThrough({ path: file.path }).then(started, (error) => {
    asking(about, false)
    toastError(error, t`Couldn't start going through it.`)
  })
}

// Without core (pnpm dev:web) a Go through runs for a few seconds and then stops with a sentence, so both
// the menu's working row and its Retry row can be seen
function mockGoThrough(about: ChatAbout) {
  const chatId = `mock-${aboutKey(about)}`
  const reply = { id: `${chatId}-${Date.now()}`, role: "assistant" as const, parts: [], createdAt: Date.now() }
  heardStarted({ chatId, about, reply: { ...reply, status: "streaming" } })
  setTimeout(() => {
    if (useStarted.getState().byAbout[aboutKey(about)]?.reply?.id !== reply.id) return
    heardStarted({ chatId, about, reply: { ...reply, status: "error", error: t`Owlit was closed before it finished.`, cutOff: "closed", finishedAt: Date.now() } })
  }, MOCK_WORKING_MS)
}

const MOCK_WORKING_MS = 6000

export function setOwlitOut(path: string, out: boolean) {
  rpc.docs.setOwlitOut({ path, out }).then(
    (state) => put(path, state),
    (error) => toastError(error, out ? t`Couldn't keep Owlit out of this doc.` : t`Couldn't let Owlit back into this doc.`),
  )
}

if (isDesktop) {
  onNotify("docs.owlit", ({ path, state }) => put(path, state))
  onWorkspaceOpened(() => useDocOwlitStore.setState({ byPath: {} }))
}
