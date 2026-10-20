// What the person last looked at and what changed since, as core keeps it (.owlit/seen/<person>.json and
// changes.unseen): every "new" mark in the window reads this one store. A mark the window makes shows at
// once and goes to core; core's answer, asked again whenever something could have changed, replaces it.

import { applySeen, unseenOf, type Change, type ChangedPassage, type ChangeFilter, type Proposal, type SeenMark, type SeenMarks, type Unseen } from "@owlit/protocol"
import { create } from "zustand"
import { useChatStore } from "@/features/chat/store"
import { me } from "@/lib/actors"
import { onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened } from "@/lib/workspace"

interface SeenState {
  // Core's marks have come
  loaded: boolean
  marks: SeenMarks
  unseen: Unseen
}

const NONE: Unseen = { changes: [], chats: [], digests: [] }
const NO_MARKS: SeenMarks = { since: 0, docs: {}, threads: {}, chats: {}, comments: {}, digests: {} }

export const useSeen = create<SeenState>(() => ({ loaded: false, marks: NO_MARKS, unseen: NONE }))

// Counts the times the change log gained an entry (or a workspace opened): what reads the log reads it
// again when this moves, not each time a mark is made
export const useLogVersion = create<{ version: number }>(() => ({ version: 0 }))
const logGrew = () => useLogVersion.setState((s) => ({ version: s.version + 1 }))

// Marks made here that core's answer may not hold yet, each with the first load asked after core took it
// (Infinity while it is on its way). An answer older than that has the mark put on it again, so a reply
// that ends as it is seen doesn't flash as unseen between core's answer and the mark.
const pending = new Map<SeenMark & { at: number }, number>()
let loads = 0

// marks and unseen with one more mark: the changes still newer than the marks, and the chat or digest
// just seen gone; null when the mark moves nothing
function withMark(state: Pick<SeenState, "marks" | "unseen">, mark: SeenMark & { at: number }): Pick<SeenState, "marks" | "unseen"> | null {
  const person = me()
  const marks = structuredClone(state.marks)
  if (!applySeen(marks, mark, mark.at)) return null
  const { unseen } = state
  return {
    marks,
    unseen: {
      changes: person ? unseenOf(marks, person, { changes: unseen.changes, chats: [], papers: [] }).changes : unseen.changes,
      chats: mark.kind === "chat" ? unseen.chats.filter((id) => id !== mark.id) : unseen.chats,
      digests: mark.kind === "digest" ? unseen.digests.filter((id) => id !== mark.paper) : unseen.digests,
    },
  }
}

// The person has this on screen now
export function markSeen(seen: SeenMark) {
  const mark = { ...seen, at: Date.now() }
  const next = withMark(useSeen.getState(), mark)
  if (!next) return
  // Shown at once
  useSeen.setState(next)
  pending.set(mark, Infinity)
  rpc.seen.mark(mark).then(
    () => {
      pending.set(mark, loads + 1)
      refresh()
    },
    () => pending.delete(mark),
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
  const load = ++loads
  const [marks, unseen] = await Promise.all([rpc.seen.get({}), rpc.changes.unseen({})]).catch(() => [null, null] as const)
  if (!marks || !unseen) return
  let answer = { marks, unseen }
  for (const [mark, heldFrom] of pending) {
    if (load >= heldFrom) pending.delete(mark)
    else answer = withMark(answer, mark) ?? answer
  }
  useSeen.setState({ loaded: true, ...answer })
}

// The log's entries, newest first
export const listChanges = (filter: ChangeFilter): Promise<Change[]> => rpc.changes.list(filter)

// The paragraphs of a doc someone else wrote since the text whose sha1 is hash
export const changedPassages = (path: string, hash: string, text: string): Promise<ChangedPassage[]> => rpc.changes.since({ path, hash, text })

// Owlit's standing changes to a doc since the text whose sha1 is hash (else since the person's marks
// began), as passages to mark in the doc; text: the doc as the editor has it
export const proposalsOf = (path: string, text: string, hash: string | undefined): Promise<Proposal[]> =>
  rpc.changes.proposals({ path, text, ...(hash ? { hash } : { since: useSeen.getState().marks.since }) })

export function startSeen() {
  refresh()
  // A reply ending, or a digest coming, can make something new
  useChatStore.subscribe((s, prev) => s.streaming !== prev.streaming && Object.keys(prev.streaming).some((id) => !s.streaming[id]) && refresh())
  onWorkspaceOpened(() => {
    logGrew()
    pending.clear()
    useSeen.setState({ loaded: false, marks: NO_MARKS, unseen: NONE })
    refresh()
  })
  onNotify("seen.changed", (marks) => {
    useSeen.setState({ marks })
    refresh()
  })
  onNotify("changes.added", logGrew)
  for (const topic of ["changes.added", "threads.changed", "comments.changed", "library.changed", "chats.turn"] as const) onNotify(topic, refresh)
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
