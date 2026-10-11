import type { WorkspaceFile } from "@owlit/protocol"
import { isAbstractOnly, isOwlit, isYou, lineKey, paperRef } from "../format"
import type { Connection, ConnectionKind, Have, Line, PaperKnowledge, Passage, Topic } from "../types"

// What a paper's Knowledge tab shows. Each item pairs something the user has (their words, a question, a
// line in a topic) with a passage of the paper; the group says the relation.

export type Group = ConnectionKind | "taken"

// Whose the item is, which the tab words as "You wrote in Draft · Sep 3", "Your question in When to call"…
export type Who =
  | { kind: "doc"; file: WorkspaceFile; at: number }
  | { kind: "question"; topic: Topic; questionId: string }
  | { kind: "line"; topic: Topic; line: Line }
  // A line a topic took from this paper: the paper speaks it
  | { kind: "taken"; topic: Topic; line: Line }

export interface Item {
  key: string
  group: Group
  who: Who
  words: string
  muted?: boolean
  passage?: Passage
  relation?: string
  fresh?: boolean
  connection?: Connection
  taken?: { topic: Topic; line: Line; found?: Passage }
}

// The thing a connection pairs the paper with, while it still exists
function resolve(h: Have, topics: Map<string, Topic>, byPath: Map<string, WorkspaceFile>): { who: Who; words: string } | null {
  if (h.kind === "doc") {
    const file = byPath.get(h.path)
    return file ? { who: { kind: "doc", file, at: h.at }, words: h.quote.replace(/\$([^$]+)\$/g, "$1") } : null
  }
  const topic = topics.get(h.topicId)
  if (!topic || topic.archived) return null
  if (h.kind === "question") {
    const q = topic.questions.find((x) => x.id === h.questionId)
    return q ? { who: { kind: "question", topic, questionId: q.id }, words: q.text } : null
  }
  const line = topic.lines.find((x) => x.id === h.lineId)
  return line ? { who: { kind: "line", topic, line }, words: line.text } : null
}

const isFreshGuess = (c: Connection, seenBefore: number) => c.kind === "might" && c.createdAt > seenBefore

// Everything the tab shows, connections first, then the lines topics took from the paper
export function paperItems(paperId: string, k: PaperKnowledge, topics: Topic[], byPath: Map<string, WorkspaceFile>, seenBefore: number): Item[] {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const items: Item[] = []
  for (const c of k.connections) {
    if (k.dismissed.includes(c.id)) continue
    const have = resolve(c.have, byId, byPath)
    if (!have) continue
    items.push({ key: c.id, group: c.kind, ...have, passage: k.passages[c.passageId], relation: c.relation, connection: c, fresh: isFreshGuess(c, seenBefore) })
  }

  for (const topic of topics) {
    if (topic.archived) continue
    for (const line of topic.lines) {
      if (isYou(line) || isOwlit(line)) continue
      const ref = line.sources.map((r) => paperRef(r.uri)).find((r) => r?.id === paperId)
      if (!ref) continue
      const key = lineKey(topic.id, line.id)
      const found = k.found?.[key]
      items.push({
        key,
        group: "taken",
        who: { kind: "taken", topic, line },
        words: line.text,
        muted: isAbstractOnly(line),
        passage: ref.passage ? k.passages[ref.passage] : undefined,
        taken: { topic, line, found: found ? k.passages[found.passageId] : undefined },
      })
    }
  }
  return items
}

// Whether a guess Owlit made is still unseen, for the dot on the tab: only guesses the tab would show count
export function hasUnseenGuess(k: PaperKnowledge | undefined, topics: () => Topic[], byPath: () => Map<string, WorkspaceFile>) {
  const fresh = k?.connections.filter((c) => isFreshGuess(c, k.seenAt) && !k.dismissed.includes(c.id))
  if (!fresh?.length) return false
  const byId = new Map(topics().map((t) => [t.id, t]))
  return fresh.some((c) => resolve(c.have, byId, byPath()) !== null)
}
