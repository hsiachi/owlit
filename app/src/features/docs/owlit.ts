// Owlit and each doc, as core keeps it (.owlit/docs/owlit.json): whether the user keeps Owlit out of it,
// and Owlit's last look. Read when a doc's header shows, kept current by docs.owlit.

import { t } from "@lingui/core/macro"
import { isOpenComment, isOwlit, type DocOwlit } from "@owlit/protocol"
import { useEffect } from "react"
import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"
import { unseenComments, useSeen } from "@/app/seen"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toast } from "sonner"
import { toastError } from "@/lib/toast"
import { onWorkspaceOpened } from "@/lib/workspace"
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

// The task kind of a Go through, whose subject is the doc's path
export const GO_THROUGH = "meetings.goThrough"

// Owlit goes through this doc as material from people (a meeting's transcript, reviews) against the
// user's other docs. What it finds lands as comments; until then the doc's ⋯ menu offers to stop it.
export function goThrough(file: { path: string }) {
  const name = displayName(file.path)
  rpc.docs.goThrough({ path: file.path }).then(
    () => toast(t`Owlit is going through “${name}”`, { description: t`What it finds will come as comments. The doc's menu can stop it.` }),
    (error) => toastError(error, t`Couldn't start going through it.`),
  )
}

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
