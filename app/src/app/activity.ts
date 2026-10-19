// Reports what the user does to core as activity events (protocol's ActivityEvent): which paper or doc
// is open, time spent reading it and on which pages, page turns, stars, status and tags, highlights,
// note and doc edits, chats written in and left.
// Core journals the coarse ones (unless settings.activity.enabled is off) and hands all of them to live
// listeners (a visit's end, for whether it read the paper in full). Nothing is sent without the desktop app.

import { isOwlit, type ActivityEvent, type ChatMessage, type PaperMark, type PaperView } from "@owlit/protocol"
import type { router as appRouter } from "@/app/router"
import { useAgentWindow } from "@/features/agent/store"
import { useBeside } from "@/features/agent/beside"
import { isChatsFromDisk } from "@/features/chat/disk"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { isLibraryFromCore } from "@/features/library/disk"
import { useLibraryStore } from "@/features/library/store"
import { isDesktop, rpc } from "@/lib/rpc"
import { ReadingClock } from "@/app/reading-clock"
import { routeSubject } from "@/app/route-subject"

type Event = ActivityEvent extends infer E ? (E extends ActivityEvent ? Omit<E, "at"> : never) : never

// How long typing must pause before an edit counts as one
const EDIT_PAUSE = 2000
// No key, click, scroll or pointer move for this long with the window in front: the person is away.
// Long enough for a dense page read without touching anything
const STILL_AFTER = 5 * 60_000

function send(event: ActivityEvent) {
  void rpc.activity.emit({ event }).catch((error) => console.warn("[owlit] activity not sent", error))
}

function emit(partial: Event) {
  send({ ...partial, at: Date.now() } as ActivityEvent)
}

// ---- Edits: one event once typing pauses ----

interface Pending {
  timer: ReturnType<typeof setTimeout>
  fire: () => void
  cancel: () => void
}
const pending = new Map<string, Pending>()

function afterPause(key: string, fire: () => void) {
  pending.get(key)?.cancel()
  const entry: Pending = {
    timer: setTimeout(() => entry.fire(), EDIT_PAUSE),
    fire: () => {
      entry.cancel()
      fire()
    },
    cancel: () => {
      clearTimeout(entry.timer)
      pending.delete(key)
    },
  }
  pending.set(key, entry)
}

const flushPending = (key: string) => pending.get(key)?.fire()

// Called by the doc editor for changes the user made (typing, deleting, undo), never for an agent's
// edit or a link that followed a rename
export function reportDocEdited(fileId: string) {
  afterPause(`doc:${fileId}`, () => {
    const path = useDocsStore.getState().files[fileId]?.path
    if (path) emit({ kind: "doc.edited", path })
  })
}

// ---- Reading time: the open paper, with the window in front and the person there ----

let reading: ReadingClock | null = null
// The paper page says which view it shows; it may say so before or after the paper counts as open
let shownView: { paperId: string; view: PaperView | null } | null = null
let lastInput = Date.now()

function startReading(paperId: string) {
  const view = shownView?.paperId === paperId ? shownView.view : null
  const page = useLibraryStore.getState().papers[paperId]?.position?.page ?? 1
  reading = new ReadingClock(paperId, view, page, emit)
}

function stopReading() {
  reading?.settle()
  reading = null
}

const present = () => document.visibilityState === "visible" && document.hasFocus() && Date.now() - lastInput <= STILL_AFTER

// Called by the paper page whenever it shows the digest or the PDF; null when the PDF side has no PDF
export function reportPaperView(paperId: string, view: PaperView | null) {
  shownView = { paperId, view }
  if (reading?.paperId === paperId) reading.setView(view)
}

// Called by the digest when its end comes into view; once per showing is enough, core keeps it
export function reportPaperEnd(paperId: string, view: PaperView) {
  if (open.paperId === paperId) emit({ kind: "paper.end", paperId, view })
}

// ---- What is open: from the route, the agent window, the paper beside a doc and the stores ----

interface Open {
  paperId?: string
  doc?: { id: string; path: string }
  chats: Set<string>
}

let open: Open = { chats: new Set() }
// Chats the user has written in since they last left them
const wroteIn = new Set<string>()

function openFromRoute(pathname: string): Open {
  const subject = routeSubject(pathname)
  const docId = subject?.kind === "doc" ? subject.id : undefined
  const docPath = docId ? useDocsStore.getState().files[docId]?.path : undefined
  const agent = useAgentWindow.getState()
  const chats = new Set<string>()
  if (subject?.kind === "chat") chats.add(subject.id)
  if (agent.stage === "open" && agent.chatId) chats.add(agent.chatId)
  // A paper read beside the doc it is cited in is open as on its own page, so checking a claim counts as reading
  const beside = docId && agent.stage !== "open" ? useBeside.getState().paper?.paperId : undefined
  return {
    paperId: subject?.kind === "paper" ? subject.id : beside,
    doc: docId && docPath ? { id: docId, path: docPath } : undefined,
    chats,
  }
}

function closePaper(paperId: string) {
  flushPending(`note:${paperId}`)
  stopReading()
  emit({ kind: "paper.closed", paperId })
}

function leaveChats(stillOpen: Set<string>) {
  for (const chatId of [...wroteIn]) {
    if (stillOpen.has(chatId)) continue
    wroteIn.delete(chatId)
    emit({ kind: "chat.ended", chatId })
  }
}

function update(next: Open) {
  if (open.paperId !== next.paperId) {
    if (open.paperId) closePaper(open.paperId)
    if (next.paperId) {
      emit({ kind: "paper.opened", paperId: next.paperId })
      startReading(next.paperId)
    }
  }
  if (open.doc?.id !== next.doc?.id) {
    if (open.doc) flushPending(`doc:${open.doc.id}`)
    if (next.doc) emit({ kind: "doc.opened", path: next.doc.path })
  }
  leaveChats(next.chats)
  open = next
}

// ---- Start ----

let started = false

export function startActivity(router: typeof appRouter) {
  if (!isDesktop || started) return
  started = true

  const refresh = () => update(openFromRoute(router.state.location.pathname))
  router.subscribe(refresh)
  useAgentWindow.subscribe(refresh)
  useBeside.subscribe(refresh)
  refresh()

  // Page turns in the open paper (for its reading time), marks, highlights and the paper's note
  useLibraryStore.subscribe((state, prev) => {
    if (open.paperId) {
      const page = state.papers[open.paperId]?.position?.page
      if (page && page !== prev.papers[open.paperId]?.position?.page) reading?.setPage(page)
    }
    // What loading the library (or another program's change) put in the store isn't something the user did
    if (isLibraryFromCore()) return
    if (state.papers !== prev.papers) {
      for (const p of Object.values(state.papers)) {
        const before = prev.papers[p.id]
        if (!before || before === p) continue
        for (const mark of marksBetween(before, p)) emit({ kind: "paper.marked", paperId: p.id, mark })
      }
    }
    // A highlight Owlit made when asked is the user's to keep, but not something they marked themselves
    if (state.highlights !== prev.highlights) {
      for (const h of Object.values(state.highlights))
        if (!prev.highlights[h.id] && !isOwlit(h.addedBy)) emit({ kind: "highlight.added", paperId: h.paperId, highlightId: h.id })
      for (const h of Object.values(prev.highlights))
        if (!state.highlights[h.id] && !isOwlit(h.addedBy)) emit({ kind: "highlight.removed", paperId: h.paperId, highlightId: h.id })
    }
    if (state.notes !== prev.notes) {
      for (const note of Object.values(state.notes)) {
        if (note.content === prev.notes[note.paperId]?.content) continue
        afterPause(`note:${note.paperId}`, () => emit({ kind: "note.edited", paperId: note.paperId }))
      }
    }
  })

  // A message the user sent, which makes leaving the chat a chat.ended. A streamed reply changes one chat's
  // object on every chunk, so only changed chats are counted, and each message list once (the previous
  // state's count is remembered from before).
  useChatStore.subscribe((state, prev) => {
    // Chats read from the workspace aren't messages being sent
    if (state.chats === prev.chats || isChatsFromDisk()) return
    let sent = false
    for (const [id, chat] of Object.entries(state.chats)) {
      const before = prev.chats[id]
      if (chat === before || userMessages(chat.messages) <= (before ? userMessages(before.messages) : 0)) continue
      wroteIn.add(id)
      sent = true
    }
    // A chat sent from the agent window may open only now; nothing else here changes what is open
    if (sent) refresh()
  })

  // Reading time, a second at a time; leaving the window settles what was read so far
  setInterval(() => {
    if (present()) reading?.tick(1000)
  }, 1000)
  const settle = () => reading?.settle()
  window.addEventListener("blur", settle)
  document.addEventListener("visibilitychange", settle)
  const there = () => {
    lastInput = Date.now()
  }
  for (const type of ["keydown", "pointerdown", "pointermove", "wheel"]) window.addEventListener(type, there, { capture: true, passive: true })

  // Closing or reloading the window closes what was open
  window.addEventListener("pagehide", () => {
    for (const entry of [...pending.values()]) entry.fire()
    update({ chats: new Set() })
  })
}

// How many of a chat's messages are the user's, once per message list
const userCounts = new WeakMap<readonly ChatMessage[], number>()
function userMessages(messages: readonly ChatMessage[]) {
  let n = userCounts.get(messages)
  if (n === undefined) userCounts.set(messages, (n = messages.filter((m) => m.role === "user").length))
  return n
}

type Marked = Pick<ReturnType<typeof useLibraryStore.getState>["papers"][string], "starred" | "status" | "tags" | "lastOpenedAt">

// What the person changed of a paper's star, status and tags. A status that moved together with the
// last-read time is the app's own markReading (lib/reading.ts), not a mark the person set.
function marksBetween(before: Marked, after: Marked): PaperMark[] {
  const marks: PaperMark[] = []
  if (after.starred !== before.starred) marks.push({ what: "starred", to: after.starred })
  if (after.status !== before.status && after.lastOpenedAt === before.lastOpenedAt) marks.push({ what: "status", to: after.status })
  if (after.tags !== before.tags && after.tags.join("\n") !== before.tags.join("\n")) marks.push({ what: "tags", to: after.tags })
  return marks
}
