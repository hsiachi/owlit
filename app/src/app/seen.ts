// What the person last looked at and what changed since, as core keeps it (.owlit/seen/<person>.json and
// changes.unseen): every "new" mark in the window reads this one store. A mark the window makes shows at
// once and goes to core; core's answer, asked again whenever something could have changed, replaces it.

import { applySeen, unseenOf, type Absence, type Change, type ChangedPassage, type ChangeFilter, type SeenMark, type SeenMarks, type Unseen } from "@owlit/protocol"
import { create } from "zustand"
import { useChatStore } from "@/features/chat/store"
import { useLibraryStore } from "@/features/library/store"
import { me, WEB_ME } from "@/lib/actors"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"
import { MOCK_AWAY, MOCK_CHANGES, MOCK_MARKS, MOCK_PASSAGES } from "./seen-mock"

interface SeenState {
  // Core's marks have come (the browser preview's are there from the start)
  loaded: boolean
  marks: SeenMarks
  unseen: Unseen
  // The person's last stretch away that has ended, and the last one in this run of the app that was long
  // enough for Home to say all that changed (a short one after it doesn't take that away)
  away: Absence | null
  long: Absence | null
}

// Away this long, Home says everything others changed meanwhile, not only Owlit's runs
export const LONG_AWAY = 3 * 24 * 3_600_000

const withAway = (away: Absence | null, long: Absence | null) => ({ away, long: away && away.to - away.from >= LONG_AWAY ? away : long })

const NONE: Unseen = { changes: [], chats: [], digests: [] }
const NO_MARKS: SeenMarks = { since: 0, docs: {}, threads: {}, chats: {}, comments: {}, digests: {} }

export const useSeen = create<SeenState>(() => ({ loaded: !isDesktop, marks: isDesktop ? NO_MARKS : MOCK_MARKS, unseen: NONE, ...withAway(isDesktop ? null : MOCK_AWAY, null) }))

// The person has this on screen now
export function markSeen(mark: SeenMark) {
  const person = me()
  const at = Date.now()
  const marks = structuredClone(useSeen.getState().marks)
  if (!applySeen(marks, mark, at)) return
  const { unseen } = useSeen.getState()
  // Shown at once: the changes still newer than the marks, and the chat or digest just seen gone
  useSeen.setState({
    marks,
    unseen: {
      changes: person ? unseenOf(marks, person, { changes: unseen.changes, chats: [], papers: [] }).changes : unseen.changes,
      chats: mark.kind === "chat" ? unseen.chats.filter((id) => id !== mark.id) : unseen.chats,
      digests: mark.kind === "digest" ? unseen.digests.filter((id) => id !== mark.paper) : unseen.digests,
    },
  })
  if (!isDesktop) return
  rpc.seen.mark({ ...mark, at }).then(
    () => refresh(),
    () => undefined,
  )
}

// Asks core again; while an answer is on its way, one more ask waits for it, however many come meanwhile
let asking: Promise<void> | null = null
let again = false
export function refresh() {
  if (asking) {
    again = true
    return
  }
  asking = load().finally(() => {
    asking = null
    if (again) {
      again = false
      refresh()
    }
  })
}

async function load() {
  if (!isDesktop) {
    // The browser preview works it out from its mock data, as core would
    const { marks } = useSeen.getState()
    const chats = Object.values(useChatStore.getState().chats)
    const papers = Object.values(useLibraryStore.getState().papers)
    useSeen.setState({ unseen: unseenOf(marks, WEB_ME, { changes: MOCK_CHANGES, chats, papers }) })
    return
  }
  const [marks, unseen, away] = await Promise.all([rpc.seen.get({}), rpc.changes.unseen({}), rpc.presence.away()]).catch(() => [null, null, null] as const)
  if (marks && unseen) useSeen.setState((s) => ({ loaded: true, marks, unseen, ...withAway(away, s.long) }))
}

// The log's entries, newest first (the browser preview's own: since and the target's kind only)
export function listChanges(filter: ChangeFilter): Promise<Change[]> {
  if (!isDesktop) return Promise.resolve(MOCK_CHANGES.filter((c) => c.at >= (filter.since ?? 0) && (!filter.target?.kind || c.target.kind === filter.target.kind)))
  return rpc.changes.list(filter)
}

// The paragraphs of a doc someone else wrote since the text whose sha1 is hash
export function changedPassages(path: string, hash: string): Promise<ChangedPassage[]> {
  if (!isDesktop) return Promise.resolve(MOCK_PASSAGES[path] ?? [])
  return rpc.changes.since({ path, hash })
}

export function startSeen() {
  refresh()
  // A reply ending, or a digest coming, can make something new
  useChatStore.subscribe((s, prev) => s.streaming !== prev.streaming && Object.keys(prev.streaming).some((id) => !s.streaming[id]) && refresh())
  if (!isDesktop) {
    useLibraryStore.subscribe((s, prev) => s.papers !== prev.papers && refresh())
    return
  }
  onWorkspaceOpened(() => {
    useSeen.setState({ loaded: false, marks: NO_MARKS, unseen: NONE, away: null, long: null })
    refresh()
  })
  onNotify("seen.changed", (marks) => {
    useSeen.setState({ marks })
    refresh()
  })
  onNotify("presence.away", (away) => useSeen.setState((s) => withAway(away, s.long)))
  for (const topic of ["changes.added", "threads.changed", "comments.changed", "library.changed", "chats.run"] as const) onNotify(topic, refresh)
}

// ---- What each place reads ----

const EMPTY: string[] = []

// The items of a thread with a change the person hasn't seen; the same array while that doesn't change
export const threadDots = (unseen: Unseen, threadId: string) => {
  const items = unseen.changes.filter((c) => c.target.kind === "thread" && c.target.path === threadId).map((c) => c.target.part!)
  return items.length ? items : EMPTY
}

// A thread is new to the person until they first look at it, and again while it holds something unseen
export const useThreadFresh = (threadId: string) => useSeen((s) => s.marks.threads[threadId]?.[threadId] === undefined || threadDots(s.unseen, threadId).length > 0)

// The ids of a doc's comments the person hasn't seen
export const unseenComments = (unseen: Unseen, path: string) => {
  const ids = unseen.changes.filter((c) => c.target.kind === "comment" && c.target.path === path).map((c) => c.target.part!)
  return ids.length ? ids : EMPTY
}

export const useChatUnseen = (chatId: string) => useSeen((s) => s.unseen.chats.includes(chatId))
export const useDigestUnseen = (paperId: string | undefined) => useSeen((s) => !!paperId && s.unseen.digests.includes(paperId))
