// Reports what the user does to core as activity events (protocol's ActivityEvent): which paper or doc
// is open, page turns, highlights, note and doc edits, chats written in and left, the window going idle.
// Core journals the coarse ones and hands all of them to live listeners. Nothing is sent without the
// desktop app or while activity is turned off (settings.activity.enabled).

import type { ActivityEvent } from "@owlit/protocol"
import type { router as appRouter } from "@/app/router"
import { useAgentWindow } from "@/features/agent/store"
import { isChatsFromDisk } from "@/features/chat/disk"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { isLibraryFromCore } from "@/features/library/disk"
import { useLibraryStore } from "@/features/library/store"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"

type Event = ActivityEvent extends infer E ? (E extends ActivityEvent ? Omit<E, "at"> : never) : never

// How long typing must pause before an edit counts as one
const EDIT_PAUSE = 2000
// How long the window must sit in the background before it counts as idle
const IDLE_AFTER = 30_000

// null until core has said whether activity is on; events from that moment wait in `early`
let enabled: boolean | null = null
let early: ActivityEvent[] = []

function send(event: ActivityEvent) {
  void rpc.activity.emit({ event }).catch((error) => console.warn("[owlit] activity not sent", error))
}

function emit(partial: Event) {
  const event = { ...partial, at: Date.now() } as ActivityEvent
  if (enabled === null) early.push(event)
  else if (enabled) send(event)
}

function setEnabled(value: boolean) {
  enabled = value
  if (value) early.forEach(send)
  else for (const flush of pending.values()) flush.cancel()
  early = []
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

// ---- What is open: from the route, the agent window and the stores ----

interface Open {
  paperId?: string
  doc?: { id: string; path: string }
  chats: Set<string>
}

let open: Open = { chats: new Set() }
// Chats the user has written in since they last left them
const wroteIn = new Set<string>()

function openFromRoute(pathname: string): Open {
  const paper = /^\/library\/([^/]+)$/.exec(pathname)?.[1]
  const docId = /^\/docs\/([^/]+)$/.exec(pathname)?.[1]
  const routeChat = /^\/chat\/([^/]+)$/.exec(pathname)?.[1]
  const docPath = docId ? useDocsStore.getState().files[docId]?.path : undefined
  const agent = useAgentWindow.getState()
  const chats = new Set<string>()
  if (routeChat) chats.add(decodeURIComponent(routeChat))
  if (agent.stage === "open" && agent.chatId) chats.add(agent.chatId)
  return {
    paperId: paper && paper !== "up-next" ? decodeURIComponent(paper) : undefined,
    doc: docId && docPath ? { id: docId, path: docPath } : undefined,
    chats,
  }
}

function closePaper(paperId: string) {
  flushPending(`note:${paperId}`)
  emit({ kind: "paper.closed", paperId })
}

function closeDoc(doc: { id: string; path: string }) {
  flushPending(`doc:${doc.id}`)
  // Its path now, should it have been renamed while open
  emit({ kind: "doc.closed", path: useDocsStore.getState().files[doc.id]?.path ?? doc.path })
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
    if (next.paperId) emit({ kind: "paper.opened", paperId: next.paperId })
  }
  if (open.doc?.id !== next.doc?.id) {
    if (open.doc) closeDoc(open.doc)
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

  void rpc.activity.status().then(({ enabled }) => setEnabled(enabled))
  onNotify("activity.status", ({ enabled }) => setEnabled(enabled))

  const refresh = () => update(openFromRoute(router.state.location.pathname))
  router.subscribe(refresh)
  useAgentWindow.subscribe(refresh)
  refresh()

  // Page turns in the open paper, highlights and the paper's note
  useLibraryStore.subscribe((state, prev) => {
    if (open.paperId) {
      const page = state.papers[open.paperId]?.position?.page
      if (page && page !== prev.papers[open.paperId]?.position?.page)
        emit({ kind: "paper.page", paperId: open.paperId, page })
    }
    // What loading the library (or another program's change) put in the store isn't something the user did
    if (isLibraryFromCore()) return
    // A highlight Owlit made when asked is the user's to keep, but not something they marked themselves
    if (state.highlights !== prev.highlights) {
      for (const h of Object.values(state.highlights))
        if (!prev.highlights[h.id] && h.addedBy !== "agent") emit({ kind: "highlight.added", paperId: h.paperId, highlightId: h.id })
      for (const h of Object.values(prev.highlights))
        if (!state.highlights[h.id]) emit({ kind: "highlight.removed", paperId: h.paperId, highlightId: h.id })
    }
    if (state.notes !== prev.notes) {
      for (const note of Object.values(state.notes)) {
        if (note.content === prev.notes[note.paperId]?.content) continue
        afterPause(`note:${note.paperId}`, () => emit({ kind: "note.edited", paperId: note.paperId }))
      }
    }
  })

  // A message the user sent
  const userMessages = (chats: ReturnType<typeof useChatStore.getState>["chats"], id: string) =>
    chats[id]?.messages.filter((m) => m.role === "user").length ?? 0
  useChatStore.subscribe((state, prev) => {
    // Chats read from the workspace aren't messages being sent
    if (state.chats === prev.chats || isChatsFromDisk()) return
    for (const id of Object.keys(state.chats)) {
      if (userMessages(state.chats, id) <= userMessages(prev.chats, id)) continue
      wroteIn.add(id)
      emit({ kind: "chat.sent", chatId: id })
    }
    // A chat sent from the agent window may open only now
    refresh()
  })

  // The window in the background long enough counts as idle, once per stay
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const away = () => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => emit({ kind: "idle", seconds: IDLE_AFTER / 1000 }), IDLE_AFTER)
  }
  window.addEventListener("blur", away)
  window.addEventListener("focus", () => clearTimeout(idleTimer))

  // Closing or reloading the window closes what was open
  window.addEventListener("pagehide", () => {
    for (const entry of [...pending.values()]) entry.fire()
    update({ chats: new Set() })
  })
}
