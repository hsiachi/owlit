// Owlit and each doc, as core keeps it (.owlit/docs/owlit.json): whether the user keeps Owlit out of it,
// and Owlit's last look. Read when a doc's header shows, kept current by docs.owlit.

import { t } from "@lingui/core/macro"
import { isOpenComment, isOwlit, type DocComment, type DocOwlit } from "@owlit/protocol"
import { useEffect } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { onWorkspaceOpened } from "@/lib/workspace"

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

// When the user last saw each doc's comments from Owlit, by path: newer ones carry Owlit's dot on the
// chip and the doc's row until they have been on screen a moment. A doc never opened here counts from
// when this window first kept these (since), so comments from before then aren't news. Kept per window,
// as the digests' marks are.
export const useOwlitSeen = create<{ seen: Record<string, number>; since: number; markSeen: (path: string) => void }>()(
  persist((set) => ({ seen: {}, since: Date.now(), markSeen: (path) => set((s) => ({ seen: { ...s.seen, [path]: Date.now() } })) }), { name: "owlit-doc-comments-seen" }),
)

// When the user last saw a doc's comments from Owlit
export const useOwlitSeenAt = (path: string) => useOwlitSeen((s) => s.seen[path] ?? s.since)

// Owlit's open comments on a doc that came after the user last saw its comments, oldest first
export function newOwlitComments(comments: DocComment[] | undefined, seenAt: number | undefined) {
  return (comments ?? []).filter((c) => isOpenComment(c) && !!c.entries[0] && isOwlit(c.entries[0].by) && c.createdAt > (seenAt ?? 0)).sort((a, b) => a.createdAt - b.createdAt)
}

// Owlit goes through this doc as material from people (a meeting's transcript, reviews) against the
// user's other docs. Quiet when it starts: the doc's chip breathes, and the run says what it did
export function goThrough(file: { path: string }) {
  rpc.docs.goThrough({ path: file.path }).catch((error) => toastError(error, t`Couldn't start going through it.`))
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
