// Owlit and each doc: the comments it left that the user hasn't seen, and Owlit going through a doc, in a
// chat owlit starts about it (features/chat/started.ts).

import { t } from "@lingui/core/macro"
import { isOpenComment, isOwlit, type ChatAbout } from "@owlit/protocol"
import { useShallow } from "zustand/react/shallow"
import { unseenComments, useSeen } from "@/app/seen"
import { isDesktop, rpc } from "@/lib/rpc"
import { toast } from "sonner"
import { toastError } from "@/lib/toast"
import { asking, mockStarted, standOf, stopStarted, useStand, useStarted, type StartedStand } from "@/features/chat/started"
import { useDocsStore } from "./store"
import { displayName } from "./types"

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
  // Without core (pnpm dev:web) a mock runs, so the menu's working and Retry rows can be seen
  if (!isDesktop) {
    mockStarted(about)
    return started()
  }
  asking(about, true)
  rpc.docs.goThrough({ path: file.path }).then(started, (error) => {
    asking(about, false)
    toastError(error, t`Couldn't start going through it.`)
  })
}
