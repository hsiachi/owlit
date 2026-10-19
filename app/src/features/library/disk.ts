import type { Highlight, Paper, PaperNote, PaperPatch, TrashedPaper } from "@owlit/protocol"
import { t } from "@lingui/core/macro"
import { create } from "zustand"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { followCore } from "@/lib/follow-core"
import { beforeWorkspaceSwitch, onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { createDiskFlag, createWorkspaceQueue } from "@/lib/write-queue"
import { useLibraryStore } from "./store"

// The library store's link to the workspace (library/papers/ and .owlit/papers/, through core). The
// store changes at once; this module watches it and sends each difference to core, in order: a paper
// added or removed, a field changed, a highlight, a note. A paper that comes back after a removal
// (Undo) is restored from the trash, not added again. Notes and reading positions, which change
// with every keystroke or scroll, are sent once they rest. Papers core changes on its own come in
// through library.changed and are taken as they are, without being sent back.

const onDisk = isDesktop

const NOTE_REST_MS = 500
const POSITION_REST_MS = 1000

const PATCHABLE = ["title", "authors", "year", "venue", "abstract", "kind", "ids", "starred", "status", "tags", "position", "view", "digestPosition", "lastOpenedAt"] as const

// Removed in this window and not yet put back: a paper with one of these ids reappearing is an Undo
const removedHere = new Set<string>()
const resting = new Map<string, { timer: ReturnType<typeof setTimeout>; op: () => Promise<unknown> }>()

const queue = createWorkspaceQueue({
  onError: (error) => {
    toastError(error, t`Couldn't save the library.`)
    // Read again once what is queued has gone through: a read sent at once could come back after a
    // restore queued behind the failure, and take the restored paper out of the store again
    enqueue(reload)
  },
})
const enqueue = (op: () => Promise<unknown>, after?: () => void) => queue.enqueue(op, after)

// Later calls with the same key replace earlier ones until the key has rested for ms
function afterRest(key: string, ms: number, op: () => Promise<unknown>) {
  clearTimeout(resting.get(key)?.timer)
  resting.set(key, { timer: setTimeout(() => sendResting(key), ms), op })
}

function sendResting(key: string) {
  const entry = resting.get(key)
  if (!entry) return
  clearTimeout(entry.timer)
  resting.delete(key)
  enqueue(entry.op)
}

// Sends every note and position still resting, without waiting for its rest
const sendAllResting = () => {
  for (const key of [...resting.keys()]) sendResting(key)
}

// Up while the store takes what core says, so the watcher below doesn't send it back
const coreFlag = createDiskFlag()
export const isLibraryFromCore = coreFlag.isOn
const takeFromCore = coreFlag.apply

// library.changed and noteChanged heard while the list is read are laid over it once it arrives
const follow = followCore({
  read: async () => {
    const sameWorkspace = queue.tracker()
    const listed = await rpc.library.list()
    return sameWorkspace() ? listed : undefined
  },
  take: ({ papers, highlights, notes, aliases }) => {
    takeFromCore(() =>
      useLibraryStore.setState({
        papers: byId(papers),
        aliases,
        highlights: byId(highlights),
        notes: Object.fromEntries(notes.map((n) => [n.paperId, n])),
      }),
    )
    trashChanged()
  },
})
const load = follow.load

async function reload() {
  try {
    await load()
  } catch (error) {
    console.warn("[owlit] couldn't read the library", error)
  }
}

// A paper core made or changed at the window's request (an imported PDF), taken without being sent back
function takePaper(paper: Paper) {
  takeFromCore(() => useLibraryStore.setState((s) => ({ papers: { ...s.papers, [paper.id]: paper } })))
}

// A PDF on disk imported by core (recognised, kept in the workspace) and taken into the store
export async function importPdf(path: string) {
  const imported = await rpc.library.importPdf({ path })
  takePaper(imported.paper)
  return imported
}

// ---- The trash

// Counts the times the trash may have changed: a paper removed or put back, the library read again. A
// paper added leaves the trash as it was, so an import doesn't have the removed list asked again per paper.
export const useTrashChanges = create<{ count: number }>(() => ({ count: 0 }))
const trashChanged = () => useTrashChanges.setState((s) => ({ count: s.count + 1 }))

// Papers removed in the last 30 days, for the Library's removed list; none outside the desktop app. Asked
// once the changes already queued have reached core, so a removal just made is in it.
export async function listTrash(): Promise<TrashedPaper[]> {
  if (!onDisk || !useWorkspace.getState().current) return []
  await queue.settled()
  return rpc.library.trash()
}

// Puts papers back from the trash, the way Undo does (library.restore), then reads the library again so
// their highlights and notes come back with them. Resolves once they are in the store.
export function restoreFromTrash(ids: string[]): Promise<void> {
  for (const id of ids) removedHere.delete(id)
  return new Promise((resolve) =>
    enqueue(async () => {
      await rpc.library.restore({ ids })
      await load()
    }, () => resolve()),
  )
}

// ---- Differences, store → core

function papersChanged(next: Record<string, Paper>, prev: Record<string, Paper>) {
  const added = Object.values(next).filter((p) => !prev[p.id])
  const gone = Object.keys(prev).filter((id) => !next[id])
  if (gone.length) {
    for (const id of gone) removedHere.add(id)
    enqueue(() => rpc.library.remove({ ids: gone }))
    trashChanged()
  }
  const back = added.filter((p) => removedHere.has(p.id))
  if (back.length) {
    for (const p of back) removedHere.delete(p.id)
    enqueue(async () => {
      const restored = await rpc.library.restore({ ids: back.map((p) => p.id) })
      // Core's word on what came back. The removal's library.changed can reach the window after Undo put
      // the paper back in the store, and take it out again; a paper missing now is taken from here.
      takeFromCore(() =>
        useLibraryStore.setState((s) => {
          const missing = restored.filter((p) => !s.papers[p.id])
          return missing.length ? { papers: { ...s.papers, ...byId(missing) } } : s
        }),
      )
    })
    trashChanged()
  }
  for (const paper of added) {
    if (back.includes(paper)) continue
    enqueue(async () => {
      const saved = await rpc.library.add({
        paper: { id: paper.id, title: paper.title, authors: paper.authors, ids: paper.ids, year: paper.year, venue: paper.venue, abstract: paper.abstract, kind: paper.kind },
        addedBy: paper.addedBy,
      })
      // Core knew it under another id: the store follows core
      if (saved.id !== paper.id) {
        takeFromCore(() =>
          useLibraryStore.setState((s) => {
            const papers = { ...s.papers }
            delete papers[paper.id]
            return { papers: { ...papers, [saved.id]: saved } }
          }),
        )
      }
    })
  }
  for (const paper of Object.values(next)) {
    const before = prev[paper.id]
    if (!before || before === paper) continue
    const patch: PaperPatch = {}
    for (const key of PATCHABLE) if (!same(paper[key], before[key])) (patch as Record<string, unknown>)[key] = paper[key]
    if (!Object.keys(patch).length) continue
    // Scrolling moves a position (in the PDF or the digest) many times a second; only where it comes to
    // rest is kept
    const only = Object.keys(patch).length === 1 ? Object.keys(patch)[0] : undefined
    if (only === "position" || only === "digestPosition") {
      afterRest(`${only}:${paper.id}`, POSITION_REST_MS, async () => {
        // A paper removed while its position rested has nothing to save it to
        const value = useLibraryStore.getState().papers[paper.id]?.[only]
        if (value) await rpc.library.update({ id: paper.id, patch: { [only]: value } })
      })
    } else {
      enqueue(() => rpc.library.update({ id: paper.id, patch }))
    }
  }
}

function highlightsChanged(next: Record<string, Highlight>, prev: Record<string, Highlight>, papers: Record<string, Paper>) {
  for (const h of Object.values(next)) if (prev[h.id] !== h) enqueue(() => rpc.library.putHighlight({ highlight: h }))
  for (const h of Object.values(prev)) {
    // A removed paper takes its highlights to the trash with it
    if (!next[h.id] && papers[h.paperId]) enqueue(() => rpc.library.removeHighlight({ paperId: h.paperId, id: h.id }))
  }
}

function notesChanged(next: Record<string, PaperNote>, prev: Record<string, PaperNote>, papers: Record<string, Paper>) {
  for (const note of Object.values(next)) {
    if (prev[note.paperId]?.content === note.content) continue
    afterRest(`note:${note.paperId}`, NOTE_REST_MS, async () => {
      const { papers, notes } = useLibraryStore.getState()
      // Removed while the note rested: the note went to the trash with it, and Undo sends it again
      if (papers[note.paperId]) await rpc.library.setNote({ paperId: note.paperId, content: notes[note.paperId]?.content ?? "" })
    })
  }
  for (const paperId of Object.keys(prev)) {
    if (!next[paperId] && papers[paperId]) enqueue(() => rpc.library.setNote({ paperId, content: "" }))
  }
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map((item) => [item.id, item]))

if (onDisk) {
  useLibraryStore.subscribe((state, prev) => {
    if (coreFlag.isOn() || !useWorkspace.getState().current) return
    if (state.papers !== prev.papers) papersChanged(state.papers, prev.papers)
    if (state.highlights !== prev.highlights) highlightsChanged(state.highlights, prev.highlights, state.papers)
    if (state.notes !== prev.notes) notesChanged(state.notes, prev.notes, state.papers)
  })

  onNotify("library.changed", ({ papers, removed, renamed }) =>
    follow.hear(() => {
      // A paper moved to another id: its highlights and notes move with it, so read the library again
      if (renamed && Object.keys(renamed).length) {
        enqueue(load)
        return
      }
      takeFromCore(() =>
        useLibraryStore.setState((s) => {
          const next = { ...s.papers }
          for (const paper of papers) next[paper.id] = paper
          for (const id of removed) delete next[id]
          return { papers: next }
        }),
      )
      if (removed.length) trashChanged()
    }),
  )

  // A note an agent edited (or another program changed): taken as it is, and the open note editor takes
  // it in as one undoable change
  onNotify("library.noteChanged", ({ paperId, note }) =>
    follow.hear(() =>
      takeFromCore(() =>
        useLibraryStore.setState((s) => {
          if (note) return { notes: { ...s.notes, [paperId]: note } }
          const { [paperId]: _gone, ...rest } = s.notes
          return { notes: rest }
        }),
      ),
    ),
  )

  // Closing or reloading the window: what rests goes now, since its timer won't fire
  window.addEventListener("pagehide", sendAllResting)
  // Opening another workspace drops the queue, so what rests or is queued goes to core first
  beforeWorkspaceSwitch(() => {
    sendAllResting()
    return queue.settled()
  })

  onWorkspaceOpened(() => {
    queue.reset()
    for (const { timer } of resting.values()) clearTimeout(timer)
    resting.clear()
    removedHere.clear()
    takeFromCore(() => useLibraryStore.setState({ papers: {}, highlights: {}, notes: {} }))
    enqueue(load)
  })
  // Opened before this module was loaded (a reload of the window)
  queueMicrotask(() => {
    if (useWorkspace.getState().current) enqueue(load)
  })
}
