import { collectionUri, docUri, MENTION_LINK, mentionLink, paperUri, parseOwlitUri } from "@owlit/protocol"
import { WorkspaceMention } from "@/features/chat/components/composer/mention-extension"
import { docMentionItems } from "@/features/docs/lib/mentions"
import { useDocsStore, fileAt } from "@/features/docs/store"
import type { SourceKind } from "@/features/chat/types"

// In a note, @ reaches the same workspace items as in a doc. In Markdown a mention is a link to its
// owlit:// address, the same form agents write in their answers, so a note reads correctly anywhere.
// A mention's id is a paper id, a doc's file id, or a collection's id.

function uriFor(kind: SourceKind, id: string): string {
  if (kind === "paper") return paperUri(id)
  if (kind === "doc") return docUri(useDocsStore.getState().files[id]?.path ?? id)
  return collectionUri(id)
}

function kindFor(uri: string): { kind: SourceKind; id: string } | null {
  const u = parseOwlitUri(uri)
  if (u?.kind === "paper") return { kind: "paper", id: u.id }
  if (u?.kind === "doc") return { kind: "doc", id: fileAt(u.path)?.id ?? u.path }
  if (u?.kind === "collection") return { kind: "collection", id: u.id }
  return null
}

const MENTION_AT_START = new RegExp(`^${MENTION_LINK.source}`)

export const NoteMention = WorkspaceMention.extend({
  markdownTokenName: "workspaceMention",
  markdownTokenizer: {
    name: "workspaceMention",
    level: "inline",
    start: (src: string) => src.search(MENTION_LINK),
    tokenize: (src: string) => {
      const m = MENTION_AT_START.exec(src)
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
    return mentionLink(String(label ?? id), uriFor(kind, id))
  },
}).configure({
  suggestion: { ...WorkspaceMention.options.suggestion, items: ({ query }: { query: string }) => docMentionItems(query) },
})
