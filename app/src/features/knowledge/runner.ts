import { docUri, paperUri } from "@owlit/protocol"
import { useDocsStore } from "@/features/docs/store"
import { freshId, getTopic, useKnowledgeStore, writeTopic } from "./store"
import { changeCounts, firstWords, isoDay, oneLine, paperRef } from "./format"
import { SCRIPT } from "./mocks/script"
import { capital } from "@/lib/words"
import { t } from "@lingui/core/macro"

// Owlit's update runs. The real ones will be background ACP runs of the user's agent, reading the topic
// files and what changed, and writing back through the app; this mock applies a few scripted steps
// (mocks/script.ts) with the same rules, so the UI around a run (the dot, the Updated line, the history)
// can be built and tried now.
//
// Rules every run keeps: ids stay, a line the user rewrote stays word for word, a removed line never comes
// back, "Owlit thinks" only for its own inferences, questions only from the user's words, and a paper line
// is anchored to a passage or marked abstract only.

// Applies whatever is new for a topic. Returns what changed, as the Updated line words it.
export function runUpdate(topicId: string): string | null {
  const t = getTopic(topicId)
  const k = useKnowledgeStore.getState()
  const side = k.sidecar(topicId)
  if (!t || side.paused) return null
  const removedTexts = new Set(Object.values(side.removed).map((r) => r.text))
  const next = structuredClone(t)
  const changed: string[] = []
  const history: { lineId: string; why: string; before?: string }[] = []

  for (const step of SCRIPT[topicId] ?? []) {
    if (removedTexts.has(step.line.text) || next.lines.some((l) => l.text === step.line.text)) continue
    if (step.replaces) {
      const l = next.lines.find((x) => x.id === step.replaces)
      // A line the user rewrote is theirs
      if (!l || side.edits[l.id]) continue
      history.push({ lineId: l.id, why: step.why, before: l.text })
      Object.assign(l, step.line)
      changed.push(l.id)
    } else {
      const id = freshId("s", next.lines, side)
      next.lines.push({ id, ...step.line })
      history.push({ lineId: id, why: step.why })
      changed.push(id)
    }
    if (step.source && !next.sources.some((s) => s.ref.uri === step.source!.ref.uri)) next.sources.unshift({ date: isoDay(Date.now()), ...step.source })
  }
  if (!changed.length) return null

  writeTopic(next)
  const at = Date.now()
  k.patchSidecar(topicId, (s) => ({ changedAt: { ...s.changedAt, ...Object.fromEntries(changed.map((id) => [id, at])) } }))
  for (const h of history) k.record(topicId, { lineId: h.lineId, what: h.before ? "Rewritten" : "Added", why: h.why, by: "owlit", before: h.before })
  const added = history.filter((h) => !h.before).length
  const rewritten = history.length - added
  return changeCounts(
    (
      [
        ["Added", added],
        ["Rewritten", rewritten],
      ] as [string, number][]
    ).filter(([, n]) => n > 0),
  )
}

// One run over several topics, kept as the page's "Updated" line
export function runUpdates(topicIds: string[]) {
  const items = topicIds.flatMap((topicId) => {
    const what = runUpdate(topicId)
    return what ? [{ topicId, what }] : []
  })
  if (items.length) useKnowledgeStore.getState().setLastRun({ at: Date.now(), items })
  return items
}

// ---- What the user said about a line ----

const DICTATED = /^(?:no[,.]?\s*)?(?:it should (?:say|read)|change it to|rewrite it as|rewrite as|make it|say)\s*[:,]?\s*["“]?(.+?)["”]?$/i
// A disagreement replaces the line rather than qualifying it: the user is its author
const DISAGREES = /^(?:actually|no\b|not really|not quite|that'?s (?:wrong|not right|not it)|i (?:don'?t|do not) think|i disagree|wrong\b)/i
const OPENER = /^(?:actually|no|not really|not quite|that'?s (?:wrong|not right|not it)|i (?:don'?t|do not) think (?:so|that)|i disagree|wrong)[,.:;]?\s*/i

const sentence = (s: string) => {
  const text = oneLine(s)
  return text ? capital(text) + (/[.!?]$/.test(text) ? "" : ".") : text
}

export interface Revision {
  topicId: string
  topicName: string
  lineId: string
  // 1-based position of the line in its topic
  position: number
  // Its opening words, how the chat and the change log name it
  words: string
  text: string
  how: "rewrote" | "condition" | "none"
  undo: () => void
}

// Owlit restates the line from what the user said, changing that one line. Wording the user dictates, or a
// disagreement, replaces the text and the line becomes theirs ("You rewrote"); a qualification becomes a
// condition beside the one it has; a question changes nothing. The change is the user's, so it never gets
// the dot. What they said is kept in the sidecar and shown in the line's history.
export function reviseLine(topicId: string, lineId: string, said: string, chatId?: string): Revision | null {
  const t = getTopic(topicId)
  const k = useKnowledgeStore.getState()
  const index = t?.lines.findIndex((l) => l.id === lineId) ?? -1
  if (!t || index < 0 || !said.trim()) return null
  const sideBefore = k.sidecar(topicId)
  const before = structuredClone(t)
  const was = t.lines[index]
  const line = structuredClone(was)
  const clean = said.trim()
  const dictated = DICTATED.exec(clean)
  let how: Revision["how"] = "none"

  if (dictated || DISAGREES.test(clean)) {
    line.text = sentence(dictated ? dictated[1] : clean.replace(OPENER, ""))
    line.speaker = "You"
    line.verb = "rewrote"
    delete line.condition
    how = "rewrote"
  } else if (!/\?\s*$/.test(clean)) {
    // A condition sits beside the one the line already has rather than replacing it
    line.condition = [line.condition, sentence(clean)].filter(Boolean).join(" ")
    how = "condition"
  }

  const unchanged = JSON.stringify(line) === JSON.stringify(was)
  if (unchanged) how = "none"
  if (!unchanged) writeTopic({ ...t, lines: t.lines.map((l, i) => (i === index ? line : l)) })
  const at = Date.now()
  k.patchSidecar(topicId, (s) => ({
    said: { ...s.said, [lineId]: [...(s.said[lineId] ?? []), { at, text: clean, chatId }] },
    edits: how === "rewrote" ? { ...s.edits, [lineId]: { text: line.text, at } } : s.edits,
  }))
  if (how === "rewrote") k.record(topicId, { lineId, what: "You rewrote it", why: "what you said in chat", by: "you", before: was.text })
  if (how === "condition") k.record(topicId, { lineId, what: "You added a condition", why: "what you said in chat", by: "you" })
  return {
    topicId,
    topicName: t.name,
    lineId,
    position: index + 1,
    words: firstWords(line.text),
    text: line.text,
    how,
    undo: () => {
      writeTopic(before)
      useKnowledgeStore.setState((s) => ({ topics: { ...s.topics, [topicId]: sideBefore } }))
    },
  }
}

// ---- Papers ----

// When a paper is closed after the user highlighted the passage behind an abstract-only line, Owlit rewrites
// the line from that passage
export function paperClosed(paperId: string) {
  const k = useKnowledgeStore.getState()
  const p = k.papers[paperId]
  const found = Object.entries(p?.found ?? {})
  if (!p || !found.length) return
  const items: { topicId: string; what: string }[] = []
  for (const [key, { topicId, passageId }] of found) {
    const lineId = key.split("/")[1]
    const topic = getTopic(topicId)
    const passage = p.passages[passageId]
    const line = topic?.lines.find((l) => l.id === lineId)
    if (!topic || !line || !passage || k.sidecar(topicId).edits[lineId]) continue
    const next = structuredClone(topic)
    const l = next.lines.find((x) => x.id === lineId)!
    l.sources = l.sources.map((r) => (paperRef(r.uri)?.id === paperId && paperRef(r.uri)?.abstract ? { label: passage.section, uri: paperUri(paperId, passageId) } : r))
    writeTopic(next)
    const at = Date.now()
    k.patchSidecar(topicId, (s) => ({ changedAt: { ...s.changedAt, [lineId]: at } }))
    k.record(topicId, { lineId, what: "Anchored to its passage", why: `you highlighted it in ${line.speaker}`, by: "owlit" })
    items.push({ topicId, what: t`One line anchored to the passage you highlighted` })
  }
  k.patchPaper(paperId, () => ({ found: {} }))
  if (items.length) k.setLastRun({ at: Date.now(), items })
}

// ---- Triggers ----

// A few minutes after a doc a topic draws on stops changing, Owlit updates that topic
const SETTLE_MS = 3 * 60_000
const timers = new Map<string, ReturnType<typeof setTimeout>>()

useDocsStore.subscribe((state, prev) => {
  if (state.files === prev.files) return
  for (const f of Object.values(state.files)) {
    const before = prev.files[f.id]
    if (!before || before.content === f.content || f.path.startsWith("knowledge/")) continue
    clearTimeout(timers.get(f.id))
    timers.set(
      f.id,
      setTimeout(() => {
        timers.delete(f.id)
        const uri = docUri(f.path)
        const topics = Object.values(useDocsStore.getState().files)
          .filter((x) => x.path.startsWith("knowledge/") && x.content?.includes(uri))
          .map((x) => /\nid: (.+)\n/.exec(x.content ?? "")?.[1])
          .filter((x): x is string => !!x)
        if (topics.length) runUpdates(topics)
      }, SETTLE_MS),
    )
  }
})
