import type { Mentionable } from "@/features/chat/types"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"
import { authorsYear, citationLabel } from "@/features/library/lib/format"
import { hasAllWords, queryWords } from "@/lib/words"
import { paperUri, parseOwlitUri } from "@owlit/protocol"
import { fileAt, useDocsStore } from "../store"
import { knowledgeMentionables, knowledgeRoute, knowledgeTitle } from "@/features/knowledge/mentions"
import { isHidden } from "./tree"
import { displayName, docUri, isMarkdown, parentPath, type WorkspaceFile } from "../types"

// What a mention says in prose. A paper is cited the way a writer would: "Vaswani et al. 2017".
export interface DocMention extends Mentionable {
  label: string
}

// A doc or paper as something the agent can be pointed at
export const docMentionable = (file: WorkspaceFile): Mentionable => ({
  id: file.id,
  kind: "doc",
  title: displayName(file.path),
  subtitle: parentPath(file.path) || undefined,
  uri: docUri(file.path),
})

export const paperMentionable = (paper: Paper): Mentionable => ({
  id: paper.id,
  kind: "paper",
  title: paper.title,
  subtitle: authorsYear(paper),
  uri: paperUri(paper.id),
})

// Everything @ can point to from a doc, minus the doc itself
export function allDocMentions(selfId?: string): DocMention[] {
  const papers: DocMention[] = Object.values(useLibraryStore.getState().papers)
    .sort((x, y) => (y.lastOpenedAt ?? y.addedAt) - (x.lastOpenedAt ?? x.addedAt))
    .map((p) => ({ ...paperMentionable(p), label: citationLabel(p) }))
  const docs: DocMention[] = Object.values(useDocsStore.getState().files)
    .filter((f) => f.id !== selfId && isMarkdown(f.path) && !isHidden(f.path))
    .sort((x, y) => y.modifiedAt - x.modifiedAt)
    .map((f) => ({ ...docMentionable(f), label: displayName(f.path) }))
  return [...papers, ...docs, ...knowledgeMentionables().map((k) => ({ ...k, label: k.title }))]
}

// The items whose name or where they live holds every word of the query
export function filterMentions(items: DocMention[], query: string) {
  const words = queryWords(query)
  if (!words.length) return items
  return items.filter((m) => hasAllWords(`${m.title} ${m.subtitle ?? ""} ${m.label}`, words))
}

export const docMentionItems = (query: string, selfId?: string) => filterMentions(allDocMentions(selfId), query)

// Where a mention leads inside the app
export function mentionRoute(uri: string): string | null {
  const u = parseOwlitUri(uri)
  if (u?.kind === "paper") return `/library/${u.id}${u.passage ? `?passage=${encodeURIComponent(u.passage)}` : ""}`
  if (u?.kind === "knowledge") return knowledgeRoute(u)
  if (u?.kind === "chat") return `/chat/${u.id}`
  if (u?.kind !== "doc") return null
  const file = fileAt(u.path)
  return file ? `/docs/${file.id}` : null
}

// The name a mention shows when its text is empty
export function mentionTitle(uri: string): string | undefined {
  const u = parseOwlitUri(uri)
  if (u?.kind === "knowledge") return knowledgeTitle(u)
  return u?.kind === "paper" ? useLibraryStore.getState().papers[u.id]?.title : undefined
}
