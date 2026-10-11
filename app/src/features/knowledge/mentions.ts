import type { OwlitUri } from "@owlit/protocol"
import type { Mentionable } from "@/features/chat/types"
import { topicUri } from "./format"
import { allTopics, lineKey } from "./store"

// What @ reaches in Knowledge: topics and the user's questions, never single lines. A question is
// addressed inside its topic file by its block id: owlit://knowledge/when-to-call#^q1.
export function knowledgeMentionables(): Mentionable[] {
  const topics = allTopics().filter((t) => !t.archived)
  return [
    ...topics.map((t): Mentionable => ({ id: t.id, kind: "knowledge", title: t.name, subtitle: "Topic", uri: topicUri(t.id) })),
    ...topics.flatMap((t) =>
      t.questions.map((q): Mentionable => ({ id: lineKey(t.id, q.id), kind: "knowledge", title: q.text, subtitle: `Question · ${t.name}`, uri: topicUri(t.id, q.id) })),
    ),
  ]
}

type KnowledgeUri = Extract<OwlitUri, { kind: "knowledge" }>

// owlit://knowledge/when-to-call#^q1 → /knowledge/when-to-call#q1
export const knowledgeRoute = ({ topicId, block }: KnowledgeUri) => `/knowledge/${encodeURIComponent(topicId)}${block ? `#${block}` : ""}`

// The name a knowledge mention shows when its text is empty
export function knowledgeTitle({ topicId, block }: KnowledgeUri): string | undefined {
  const t = allTopics().find((x) => x.id === topicId)
  if (!t) return undefined
  if (!block) return t.name
  return t.questions.find((q) => q.id === block)?.text ?? t.lines.find((l) => l.id === block)?.text ?? t.name
}
