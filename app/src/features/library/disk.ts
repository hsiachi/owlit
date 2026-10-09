import type { Highlight, Paper, PaperNote, PaperPatch } from "@owlit/protocol"
import { toast } from "sonner"
import { isDesktop, onNotify, rpc } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { useLibraryStore } from "./store"

// The library store's link to the workspace (library/papers/ and .owlit/papers/, through core). The
// store changes at once; this module watches it and sends each difference to core, in order: a paper
// added or removed, a field changed, a highlight, a note. A paper that comes back after a removal
// (Undo) is restored from the trash, not added again. Notes and reading positions, which change
// with every keystroke or scroll, are sent once they rest. Papers core changes on its own come in
// through library.changed and are taken as they are, without being sent back.

export const onDisk = isDesktop

const NOTE_REST_MS = 500
const POSITION_REST_MS = 1000

const PATCHABLE = ["title", "authors", "year", "venue", "abstract", "kind", "ids", "starred", "status", "tags", "position", "lastOpenedAt"] as const

let chain: Promise<void> = Promise.resolve()
let generation = 0
// Removed in this window and not yet put back: a paper with one of these ids reappearing is an Undo
const removedHere = new Set<string>()
const resting = new Map<string, ReturnType<typeof setTimeout>>()

function enqueue(op: () => Promise<unknown>) {
  const gen = generation
  chain = chain.then(async () => {
    if (gen !== generation) return
    try {
      await op()
    } catch (error) {
      if (gen !== generation) return
      toast.error(error instanceof Error ? error.message : "Couldn't save the library.")
      void reload()
    }
  })
}

// Later calls with the same key replace earlier ones until the key has rested for ms
function afterRest(key: string, ms: number, op: () => Promise<unknown>) {
  clearTimeout(resting.get(key))
  resting.set(
    key,
    setTimeout(() => {
      resting.delete(key)
      enqueue(op)
    }, ms),
  )
}

// True while the store takes what core says, so the watcher below doesn't send it back
let fromCore = false
export const isLibraryFromCore = () => fromCore
function takeFromCore(update: () => void) {
  fromCore = true
  try {
    update()
  } finally {
    fromCore = false
  }
}

async function load() {
  const gen = generation
  const { papers, highlights, notes, aliases } = await rpc.library.list()
  if (gen !== generation) return
  takeFromCore(() =>
    useLibraryStore.setState({
      papers: byId(papers),
      aliases,
      highlights: byId(highlights),
      notes: Object.fromEntries(notes.map((n) => [n.paperId, n])),
    }),
  )
}

async function reload() {
  try {
    await load()
  } catch (error) {
    console.warn("[owlit] couldn't read the library", error)
  }
}

// A paper core made or changed at the window's request (an imported PDF), taken without being sent back
export function takePaper(paper: Paper) {
  takeFromCore(() => useLibraryStore.setState((s) => ({ papers: { ...s.papers, [paper.id]: paper } })))
}

// ---- Differences, store → core

function papersChanged(next: Record<string, Paper>, prev: Record<string, Paper>) {
  const added = Object.values(next).filter((p) => !prev[p.id])
  const gone = Object.keys(prev).filter((id) => !next[id])
  if (gone.length) {
    for (const id of gone) removedHere.add(id)
    enqueue(() => rpc.library.remove({ ids: gone }))
  }
  const back = added.filter((p) => removedHere.has(p.id))
  if (back.length) {
    for (const p of back) removedHere.delete(p.id)
    enqueue(() => rpc.library.restore({ ids: back.map((p) => p.id) }))
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
    // Scrolling moves the position many times a second; only where it comes to rest is kept
    if (Object.keys(patch).length === 1 && patch.position) {
      afterRest(`position:${paper.id}`, POSITION_REST_MS, () => rpc.library.update({ id: paper.id, patch: { position: useLibraryStore.getState().papers[paper.id]?.position } }))
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
    afterRest(`note:${note.paperId}`, NOTE_REST_MS, () =>
      rpc.library.setNote({ paperId: note.paperId, content: useLibraryStore.getState().notes[note.paperId]?.content ?? "" }),
    )
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
    if (fromCore || !useWorkspace.getState().current) return
    if (state.papers !== prev.papers) papersChanged(state.papers, prev.papers)
    if (state.highlights !== prev.highlights) highlightsChanged(state.highlights, prev.highlights, state.papers)
    if (state.notes !== prev.notes) notesChanged(state.notes, prev.notes, state.papers)
  })

  onNotify("library.changed", ({ papers, removed, renamed }) => {
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
  })

  // A note an agent edited (or another program changed): taken as it is, and the open note editor takes
  // it in as one undoable change
  onNotify("library.noteChanged", ({ paperId, note }) => {
    takeFromCore(() =>
      useLibraryStore.setState((s) => {
        if (note) return { notes: { ...s.notes, [paperId]: note } }
        const { [paperId]: _gone, ...rest } = s.notes
        return { notes: rest }
      }),
    )
  })

  onWorkspaceOpened(() => {
    generation++
    for (const timer of resting.values()) clearTimeout(timer)
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
