import { parseOwlitUri, type KnowledgeRun } from "@owlit/protocol"
import { useMemo } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { newId } from "@/lib/id"
import { reportKnowledgeEdited } from "@/app/activity"
import { isDesktop } from "@/lib/rpc"
import { perFiles, useDocsStore } from "@/features/docs/store"
import type { WorkspaceFile } from "@/features/docs/types"
import { oneLine, parseTopic, serializeTopic, topicPath, topicSlug } from "./format"
import { seedLoose, seedPapers, seedSidecars, seedTopicFiles } from "./mocks/seed"
import type { Change, Connection, Line, PaperKnowledge, Passage, Ref, Topic, TopicSidecar } from "./types"
import { joinAnd } from "@/lib/words"
import { plural, t } from "@lingui/core/macro"

// Topics are the Markdown files in `knowledge/`; the Docs store stands in for the disk until the desktop
// shell exists. This store is the sidecar beside them (`.owlit/knowledge/`): what the user did to each
// line, the history, and each paper's connections. A rewrite of a topic file never touches it.

const isTopicFile = (f: WorkspaceFile) => f.path.startsWith("knowledge/") && f.path.endsWith(".md") && f.content !== undefined

const cache = new Map<string, { content: string; modifiedAt: number; path: string; topic: Topic }>()

function parse(f: WorkspaceFile): Topic {
  const hit = cache.get(f.id)
  if (hit && hit.content === f.content && hit.modifiedAt === f.modifiedAt && hit.path === f.path) return hit.topic
  const topic = parseTopic(f.path, f.content ?? "", f.modifiedAt)
  cache.set(f.id, { content: f.content ?? "", modifiedAt: f.modifiedAt, path: f.path, topic })
  return topic
}

// Newest first; built once per change to the files and shared by every reader
export const topicsOf = perFiles((files): Topic[] =>
  Object.values(files)
    .filter(isTopicFile)
    .map(parse)
    .sort((a, b) => b.updatedAt - a.updatedAt),
)

export const allTopics = () => topicsOf(useDocsStore.getState().files)
export const getTopic = (id: string) => allTopics().find((t) => t.id === id)
const fileOf = (id: string) => Object.values(useDocsStore.getState().files).find((f) => isTopicFile(f) && parse(f).id === id)

export const useTopics = (): Topic[] => topicsOf(useDocsStore((s) => s.files))

export function useTopic(id: string): Topic | undefined {
  const topics = useTopics()
  return topics.find((t) => t.id === id)
}

// Writes a topic back to its file, the way Owlit (or an edit the user made through the app) would
export function writeTopic(topic: Topic) {
  const file = fileOf(topic.id)
  const content = serializeTopic(topic)
  if (file) useDocsStore.getState().writeDoc(file.id, content)
  else useDocsStore.getState().createDocAt(topicPath(topic.name), content)
}

const blankSidecar = (): TopicSidecar => ({ seenAt: Date.now(), history: [], edits: {}, removed: {}, said: {}, changedAt: {} })

// The most recent run, for "Updated 3 min ago · 2 topics" on the Knowledge page
export type Run = KnowledgeRun

interface KnowledgeState {
  seeded: boolean
  topics: Record<string, TopicSidecar>
  papers: Record<string, PaperKnowledge>
  loose: { quote: string; ref: Ref }[]
  lastRun: Run | null

  sidecar: (topicId: string) => TopicSidecar
  patchSidecar: (topicId: string, fn: (s: TopicSidecar) => Partial<TopicSidecar>) => void
  record: (topicId: string, change: Omit<Change, "id" | "at"> & { at?: number }) => void
  markSeen: (topicId: string) => void
  setPaused: (topicId: string, paused: boolean) => void
  setLastRun: (run: Run) => void

  paper: (paperId: string) => PaperKnowledge
  patchPaper: (paperId: string, fn: (p: PaperKnowledge) => Partial<PaperKnowledge>) => void
}

const emptyPaper = (): PaperKnowledge => ({ passages: {}, connections: [], dismissed: [], seenAt: 0 })

export const useKnowledgeStore = create<KnowledgeState>()(
  persist(
    (set, get) => ({
      seeded: false,
      topics: {},
      papers: {},
      loose: [],
      lastRun: null,

      sidecar: (topicId) => get().topics[topicId] ?? blankSidecar(),
      patchSidecar: (topicId, fn) =>
        set((s) => {
          const cur = s.topics[topicId] ?? blankSidecar()
          return { topics: { ...s.topics, [topicId]: { ...cur, ...fn(cur) } } }
        }),
      record: (topicId, change) =>
        get().patchSidecar(topicId, (s) => ({ history: [{ id: newId(), at: Date.now(), ...change }, ...s.history] })),
      markSeen: (topicId) => get().patchSidecar(topicId, () => ({ seenAt: Date.now() })),
      setPaused: (topicId, paused) => get().patchSidecar(topicId, () => ({ paused })),
      setLastRun: (lastRun) => set({ lastRun }),

      paper: (paperId) => get().papers[paperId] ?? emptyPaper(),
      patchPaper: (paperId, fn) =>
        set((s) => {
          const cur = s.papers[paperId] ?? emptyPaper()
          return { papers: { ...s.papers, [paperId]: { ...cur, ...fn(cur) } } }
        }),
    }),
    // In the desktop app the workspace holds it (./disk)
    { name: "owlit-knowledge", version: 1, skipHydration: isDesktop, partialize: (s) => (isDesktop ? {} : s) },
  ),
)

// In a plain browser the seeded workspace's topic files join the seeded docs on every load (the Docs store
// lives in memory there). In the desktop app topics are whatever knowledge/ holds on disk.
function seedTopicFilesInMemory() {
  if (isDesktop) return
  const docs = useDocsStore.getState()
  const taken = new Set(Object.values(docs.files).map((f) => f.path))
  const files = { ...docs.files }
  for (const f of seedTopicFiles) {
    if (taken.has(f.path)) continue
    const id = newId()
    files[id] = { id, path: f.path, content: f.content, createdAt: f.modifiedAt, modifiedAt: f.modifiedAt, nameLocked: true }
  }
  useDocsStore.setState({ files })
}
seedTopicFilesInMemory()

// The first time the app runs with Knowledge, Owlit has already read the seeded workspace
function seed() {
  if (isDesktop) return
  const k = useKnowledgeStore.getState()
  if (k.seeded) return
  useKnowledgeStore.setState({
    seeded: true,
    topics: { ...seedSidecars, ...k.topics },
    papers: { ...seedPapers, ...k.papers },
    loose: seedLoose,
    lastRun: { at: Date.now() - 26 * 3_600_000, items: [{ topicId: "when-to-call", what: "One line added and one rewritten, from your evaluation plan and Toolformer notes" }] },
  })
}
seed()

// A new block id: never one a line or question holds, nor one the user removed or the history mentions, so
// an id always means the same line
export function freshId(prefix: string, taken: { id: string }[], side: TopicSidecar) {
  const used = new Set([...taken.map((x) => x.id), ...Object.keys(side.removed), ...side.history.flatMap((h) => (h.lineId ? [h.lineId] : []))])
  let n = 1
  while (used.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

// ---- Reading ----

// Lines Owlit added or changed since the user last looked
export function changedSince(topic: Topic, side: TopicSidecar, seenAt = side.seenAt) {
  return topic.lines.filter((l) => (side.changedAt[l.id] ?? 0) > seenAt && !side.edits[l.id])
}

// "2 docs, 2 papers and 1 chat", from what the topic's Sources point at
export function provenance(topic: Topic) {
  const kinds = { doc: new Set<string>(), paper: new Set<string>(), chat: new Set<string>() }
  for (const s of topic.sources) {
    const kind = parseOwlitUri(s.ref.uri)?.kind
    const k = kind === "paper" || kind === "chat" ? kind : "doc"
    kinds[k].add(s.ref.uri.replace(/#.*$/, ""))
  }
  const parts = [
    kinds.doc.size > 0 && plural(kinds.doc.size, { one: "# doc", other: "# docs" }),
    kinds.paper.size > 0 && plural(kinds.paper.size, { one: "# paper", other: "# papers" }),
    kinds.chat.size > 0 && plural(kinds.chat.size, { one: "# chat", other: "# chats" }),
  ].filter((p): p is string => !!p)
  return parts.length ? joinAnd(parts) : t`nothing yet`
}

// ---- Acting on lines (the user's own edits go straight to the file and are guarded by the sidecar) ----

function mutate(topicId: string, fn: (t: Topic) => Topic | null) {
  const t = getTopic(topicId)
  if (!t) return null
  const next = fn(structuredClone(t))
  if (next) writeTopic(next)
  return t
}

export function editLine(topicId: string, lineId: string, text: string) {
  const clean = oneLine(text)
  if (!clean) return
  const before = mutate(topicId, (t) => {
    const l = t.lines.find((x) => x.id === lineId)
    if (!l || l.text === clean) return null
    l.speaker = "You"
    l.verb = "rewrote"
    l.text = clean
    return t
  })
  const was = before?.lines.find((x) => x.id === lineId)
  if (!was || was.text === clean) return
  const k = useKnowledgeStore.getState()
  k.patchSidecar(topicId, (s) => ({ edits: { ...s.edits, [lineId]: { text: clean, at: Date.now() } } }))
  k.record(topicId, { lineId, what: "You rewrote it", why: "edited on the topic page", by: "you", before: was.text })
  reportKnowledgeEdited(topicId, lineId)
}

// Removes a line for good: no update brings it back. Returns an undo.
export function removeLine(topicId: string, lineId: string): (() => void) | null {
  let removed: { line: Line; index: number } | null = null
  mutate(topicId, (t) => {
    const index = t.lines.findIndex((x) => x.id === lineId)
    if (index < 0) return null
    removed = { line: t.lines[index], index }
    t.lines.splice(index, 1)
    return t
  })
  if (!removed) return null
  const { line, index } = removed as { line: Line; index: number }
  const k = useKnowledgeStore.getState()
  k.patchSidecar(topicId, (s) => ({ removed: { ...s.removed, [lineId]: { text: line.text, at: Date.now() } } }))
  k.record(topicId, { lineId, what: "You removed it", why: "it won’t come back on an update", by: "you", before: line.text })
  reportKnowledgeEdited(topicId, lineId)
  return () => {
    mutate(topicId, (t) => {
      t.lines.splice(Math.min(index, t.lines.length), 0, line)
      return t
    })
    k.patchSidecar(topicId, (s) => {
      const rest = { ...s.removed }
      delete rest[lineId]
      return { removed: rest, history: s.history.filter((h) => !(h.lineId === lineId && h.what === "You removed it")) }
    })
  }
}

// ---- Topics ----

export function renameTopic(topicId: string, name: string) {
  const clean = oneLine(name)
  const file = fileOf(topicId)
  const t = getTopic(topicId)
  if (!clean || !file || !t || clean === t.name) return
  writeTopic({ ...t, name: clean })
  useDocsStore.getState().renameFile(file.id, topicPath(clean).slice("knowledge/".length))
  useKnowledgeStore.getState().record(topicId, { what: `Renamed from “${t.name}”`, why: "you renamed it", by: "you" })
}

export function setArchived(topicId: string, archived: boolean) {
  mutate(topicId, (t) => ({ ...t, archived }))
}

export function deleteTopic(topicId: string): (() => void) | null {
  const file = fileOf(topicId)
  if (!file) return null
  const removed = useDocsStore.getState().deleteFile(file.id)
  return () => useDocsStore.getState().restore(removed)
}

// Moves every line, question and source of one topic into another. Returns an undo.
export function mergeTopic(fromId: string, intoId: string): (() => void) | null {
  const from = getTopic(fromId)
  const into = getTopic(intoId)
  const fromFile = fileOf(fromId)
  const intoFile = fileOf(intoId)
  if (!from || !into || !fromFile || !intoFile) return null
  const docs = useDocsStore.getState()
  const intoBefore = intoFile.content ?? ""
  const k = useKnowledgeStore.getState()
  const sideBefore = { from: k.sidecar(fromId), into: k.sidecar(intoId) }

  const next = structuredClone(into)
  const nextId = (prefix: string, taken: { id: string }[]) => freshId(prefix, taken, sideBefore.into)
  const now = Date.now()
  const changedAt: Record<string, number> = {}
  for (const l of from.lines) {
    const id = nextId("s", next.lines)
    next.lines.push({ ...l, id })
    changedAt[id] = now
  }
  for (const q of from.questions) next.questions.push({ ...q, id: nextId("q", next.questions) })
  next.sources = [...next.sources, ...from.sources.filter((s) => !next.sources.some((x) => x.ref.uri === s.ref.uri))]
  writeTopic(next)
  const removed = docs.deleteFile(fromFile.id)
  k.patchSidecar(intoId, (s) => ({ changedAt: { ...s.changedAt, ...changedAt } }))
  k.record(intoId, { what: `Merged in “${from.name}”`, why: "you merged the two topics", by: "you" })
  return () => {
    useDocsStore.getState().writeDoc(intoFile.id, intoBefore)
    useDocsStore.getState().restore(removed)
    useKnowledgeStore.setState((s) => ({ topics: { ...s.topics, [fromId]: sideBefore.from, [intoId]: sideBefore.into } }))
  }
}

// Moves the chosen lines into a new topic
export function splitTopic(topicId: string, lineIds: string[], name: string): string | null {
  const t = getTopic(topicId)
  const clean = oneLine(name)
  if (!t || !clean || !lineIds.length) return null
  const taken = new Set(allTopics().map((x) => x.id))
  let id = topicSlug(clean)
  for (let n = 2; taken.has(id); n++) id = `${topicSlug(clean)}-${n}`
  const moving = t.lines.filter((l) => lineIds.includes(l.id))
  const uris = new Set(moving.flatMap((l) => l.sources.map((r) => r.uri.replace(/#.*$/, ""))))
  const fresh: Topic = {
    id,
    path: topicPath(clean),
    name: clean,
    summary: "",
    lines: moving.map((l, i) => ({ ...l, id: `s${i + 1}` })),
    questions: [],
    sources: t.sources.filter((s) => uris.has(s.ref.uri.replace(/#.*$/, ""))),
    archived: false,
    updatedAt: Date.now(),
  }
  writeTopic({ ...t, lines: t.lines.filter((l) => !lineIds.includes(l.id)) })
  writeTopic(fresh)
  const k = useKnowledgeStore.getState()
  k.patchSidecar(id, () => ({ seenAt: Date.now() }))
  k.record(id, { what: `Split from “${t.name}”`, why: "you split the topic", by: "you" })
  // The history keeps English words; format's changeWords says them in the interface language
  k.record(topicId, { what: `${moving.length} ${moving.length === 1 ? "line" : "lines"} moved to “${clean}”`, why: "you split the topic", by: "you" })
  return id
}

// ---- Papers ----

export function usePaperKnowledge(paperId: string): PaperKnowledge {
  const p = useKnowledgeStore((s) => s.papers[paperId])
  return useMemo(() => p ?? emptyPaper(), [p])
}

export function setConnection(paperId: string, id: string, patch: Partial<Connection>) {
  useKnowledgeStore.getState().patchPaper(paperId, (p) => ({ connections: p.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))
}

export function dismissConnection(paperId: string, id: string) {
  useKnowledgeStore.getState().patchPaper(paperId, (p) => ({ dismissed: [...p.dismissed, id] }))
  return () => useKnowledgeStore.getState().patchPaper(paperId, (p) => ({ dismissed: p.dismissed.filter((x) => x !== id) }))
}

export function addPassage(paperId: string, passage: Passage) {
  useKnowledgeStore.getState().patchPaper(paperId, (p) => ({ passages: { ...p.passages, [passage.id]: passage } }))
}
