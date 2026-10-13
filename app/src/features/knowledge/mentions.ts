import { t } from "@lingui/core/macro"
import type { OwlitUri } from "@owlit/protocol"
import type { Mentionable } from "@/features/chat/types"
import { lineKey, topicUri } from "./format"
import { allTopics } from "./store"

// What @ reaches in Knowledge: topics and the user's questions, never single lines. A question is
// addressed inside its topic file by its block id: owlit://knowledge/when-to-call#^q1.
export function knowledgeMentionables(): Mentionable[] {
  const topics = allTopics().filter((topic) => !topic.archived)
  return [
    ...topics.map((topic): Mentionable => ({ id: topic.id, kind: "knowledge", title: topic.name, subtitle: t`Topic`, uri: topicUri(topic.id) })),
    ...topics.flatMap((topic) => {
      const name = topic.name
      return topic.questions.map((q): Mentionable => ({ id: lineKey(topic.id, q.id), kind: "knowledge", title: q.text, subtitle: t`Question · ${name}`, uri: topicUri(topic.id, q.id) }))
    }),
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
