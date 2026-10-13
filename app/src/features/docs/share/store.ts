import { t } from "@lingui/core/macro"
import type { DocShare, ShareAnchor, ShareComment, SharePermission } from "@owlit/protocol"
import { toast } from "sonner"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { useDocsStore } from "../store"
import { displayName } from "../types"
import { useDocsUiStore } from "../ui-store"

// Docs shared by link (core's share.*): which doc has a link, and what readers said on it. Keyed by the
// doc's path, as core keeps them; a rename arrives as the old path gone and the new one shared.

// A reader's comment on a passage, with the replies under it
export interface Thread {
  root: ShareComment & { anchor: ShareAnchor }
  replies: ShareComment[]
}

interface ShareState {
  // Where links are made; null when no share server is set up
  server: string | null
  byPath: Record<string, DocShare>
  comments: Record<string, ShareComment[]>
}

export const useShareStore = create<ShareState>(() => ({ server: null, byPath: {}, comments: {} }))

// The open threads of a doc's comments, in the order they were written
export function threadsOf(comments: ShareComment[] | undefined): Thread[] {
  if (!comments) return []
  return comments
    .filter((c): c is Thread["root"] => !c.parent && !!c.anchor && !c.resolved)
    .map((root) => ({ root, replies: comments.filter((c) => c.parent === root.id) }))
}

const setShare = (path: string, share: DocShare | null) =>
  useShareStore.setState((s) => {
    const byPath = { ...s.byPath }
    if (share) byPath[path] = share
    else delete byPath[path]
    return { byPath }
  })

const setComments = (path: string, comments: ShareComment[]) => useShareStore.setState((s) => ({ comments: { ...s.comments, [path]: comments } }))

async function fetchComments(path: string) {
  setComments(path, await rpc.share.comments({ path }))
}

async function load() {
  const { server, shares } = await rpc.share.list()
  useShareStore.setState({ server, byPath: Object.fromEntries(shares.map((s) => [s.path, s])), comments: {} })
  await Promise.all(shares.map((s) => fetchComments(s.path).catch(() => undefined)))
}

// A reader's new comment while owlit is open is said once, with a way to it
function sayNew(path: string, before: ShareComment[] | undefined, after: ShareComment[]) {
  if (!before) return
  const known = new Set(before.map((c) => c.id))
  const fresh = after.filter((c) => !known.has(c.id) && c.by === "reader")
  if (!fresh.length) return
  const file = Object.values(useDocsStore.getState().files).find((f) => f.path === path)
  const doc = displayName(path)
  const first = fresh[0]
  const name = first.name
  toast(fresh.length === 1 ? t`${name} commented on ${doc}` : t`${fresh.length} new comments on ${doc}`, {
    description: first.text.length > 120 ? `${first.text.slice(0, 120)}…` : first.text,
    action: file
      ? {
          label: t`Open`,
          onClick: () => {
            const thread = first.parent ?? first.id
            useDocsUiStore.getState().setOpenComment(file.id, thread)
            void import("@/app/router").then(({ router }) => router.navigate(`/docs/${file.id}`))
          },
        }
      : undefined,
  })
}

export function startShares() {
  if (!isDesktop) return
  onWorkspaceOpened(() => void load().catch(() => undefined))
  onNotify("share.changed", ({ path, share }) => {
    const had = useShareStore.getState().byPath[path]
    setShare(path, share)
    // A doc that turned up under a new name brings its comments along
    if (share && !had && !useShareStore.getState().comments[path]) void fetchComments(path).catch(() => undefined)
  })
  onNotify("share.comments", ({ path, comments }) => {
    sayNew(path, useShareStore.getState().comments[path], comments)
    setComments(path, comments)
  })
  if (useWorkspace.getState().current) void load().catch(() => undefined)
}

export const shares = {
  async create(path: string, notes: boolean) {
    const share = await rpc.share.create({ path, notes })
    setShare(path, share)
    setComments(path, [])
    return share
  },
  async update(path: string, change: { permission?: SharePermission; notes?: boolean }) {
    setShare(path, await rpc.share.update({ path, ...change }))
  },
  async stop(path: string) {
    await rpc.share.stop({ path })
    setShare(path, null)
    toast(t`Stopped sharing`, { description: t`The link no longer opens.` })
  },
  async reply(path: string, parent: string, text: string) {
    const reply = await rpc.share.reply({ path, parent, text })
    // Core's share.comments may have brought it already
    const now = useShareStore.getState().comments[path] ?? []
    if (!now.some((c) => c.id === reply.id)) setComments(path, [...now, reply])
  },
  async resolve(path: string, id: string, resolved: boolean) {
    await rpc.share.resolve({ path, id, resolved })
    setComments(
      path,
      (useShareStore.getState().comments[path] ?? []).map((c) => (c.id === id ? { ...c, resolved: resolved || undefined } : c)),
    )
  },
}
