import { WorkspaceMention } from "@/features/chat/components/composer/mention-extension"
import { searchMentionables } from "@/features/chat/mocks/sources"
import type { Mentionable, SourceKind } from "@/features/chat/types"
import { paperMeta } from "../lib/format"
import { useLibraryStore } from "../store"

// In a note, @ reaches the same workspace items as in Chat, with papers taken from the library
// itself. In Markdown a mention is a link to its owlit:// address, the same form agents write
// in their answers, so a note reads correctly anywhere.

const paperUri = (id: string) => `owlit://library/${id}`

function noteMentionables(query: string): Mentionable[] {
  const q = query.trim().toLowerCase()
  const papers: Mentionable[] = Object.values(useLibraryStore.getState().papers)
    .filter((p) => !q || p.title.toLowerCase().includes(q) || p.authors.some((a) => a.toLowerCase().includes(q)))
    .sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt))
    .map((p) => ({ id: p.id, kind: "paper", title: p.title, subtitle: paperMeta(p), uri: paperUri(p.id) }))
  // Docs and knowledge are still mocks shared with Chat
  return [...papers, ...searchMentionables(query).filter((m) => m.kind !== "paper")]
}

function uriFor(kind: SourceKind, id: string): string {
  if (kind === "paper") return paperUri(id)
  return searchMentionables("").find((m) => m.id === id)?.uri ?? `owlit://${kind}/${id}`
}

function kindFor(uri: string): { kind: SourceKind; id: string } | null {
  const m = /^owlit:\/\/(library|docs|knowledge)\/(.+)$/.exec(uri)
  if (!m) return null
  if (m[1] === "library") return { kind: "paper", id: m[2] }
  if (m[1] === "knowledge") return { kind: "knowledge", id: m[2] }
  return { kind: "doc", id: searchMentionables("").find((x) => x.uri === uri)?.id ?? m[2] }
}

// [label](owlit://library|docs|knowledge/…). Other owlit:// links, such as a quote's page link
// back to its highlight, stay ordinary links.
const MENTION_LINK = /^\[((?:\\.|[^\]\\])+)\]\((owlit:\/\/(?:library|docs|knowledge)\/[^)\s]+)\)/

const MENTION_START = /\[(?:\\.|[^\]\\])+\]\(owlit:\/\/(?:library|docs|knowledge)\//

export const NoteMention = WorkspaceMention.extend({
  markdownTokenName: "workspaceMention",
  markdownTokenizer: {
    name: "workspaceMention",
    level: "inline",
    start: (src: string) => src.search(MENTION_START),
    tokenize: (src: string) => {
      const m = MENTION_LINK.exec(src)
      if (!m) return undefined
      return { type: "workspaceMention", raw: m[0], label: m[1].replace(/\\(.)/g, "$1"), uri: m[2] }
    },
  },
  parseMarkdown: (token) => {
    const target = kindFor(String(token.uri))
    if (!target) return []
    return { type: "mention", attrs: { id: target.id, kind: target.kind, label: token.label } }
  },
  renderMarkdown: (node) => {
    const { id, kind, label } = node.attrs ?? {}
    return `[${String(label ?? id).replace(/[[\]\\]/g, "\\$&")}](${uriFor(kind, id)})`
  },
}).configure({
  suggestion: { ...WorkspaceMention.options.suggestion, items: ({ query }: { query: string }) => noteMentionables(query) },
})
