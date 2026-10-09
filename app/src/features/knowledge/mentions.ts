import type { Mentionable } from "@/features/chat/types"
import { topicUri } from "./format"
import { allTopics } from "./store"

// What @ reaches in Knowledge: topics and the user's questions, never single lines. A question is
// addressed inside its topic file by its block id: owlit://knowledge/when-to-call#^q1.
export function knowledgeMentionables(): Mentionable[] {
  const topics = allTopics().filter((t) => !t.archived)
  return [
    ...topics.map((t): Mentionable => ({ id: t.id, kind: "knowledge", title: t.name, subtitle: "Topic", uri: topicUri(t.id) })),
    ...topics.flatMap((t) =>
      t.questions.map((q): Mentionable => ({ id: `${t.id}/${q.id}`, kind: "knowledge", title: q.text, subtitle: `Question · ${t.name}`, uri: topicUri(t.id, q.id) })),
    ),
  ]
}

// owlit://knowledge/when-to-call#^q1 → /knowledge/when-to-call#q1
export function knowledgeRoute(uri: string): string | null {
  const m = /^owlit:\/\/knowledge\/([^#]+)(?:#\^?(.+))?$/.exec(uri)
  if (!m) return null
  return `/knowledge/${m[1]}${m[2] ? `#${m[2]}` : ""}`
}

// The name a knowledge mention shows when its text is empty
export function knowledgeTitle(uri: string): string | undefined {
  const m = /^owlit:\/\/knowledge\/([^#]+)(?:#\^?(.+))?$/.exec(uri)
  if (!m) return undefined
  const t = allTopics().find((x) => x.id === decodeURIComponent(m[1]))
  if (!t) return undefined
  if (!m[2]) return t.name
  return t.questions.find((q) => q.id === m[2])?.text ?? t.lines.find((l) => l.id === m[2])?.text ?? t.name
}
