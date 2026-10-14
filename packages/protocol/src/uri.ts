// owlit:// addresses: how a paper, doc, collection or chat is linked in Markdown, by agents and the
// window alike. Doc paths are percent-encoded; paper, collection and chat ids are plain.

export const paperUri = (id: string, passage?: string) => `owlit://library/${id}${passage ? `#passage=${passage}` : ""}`
export const docUri = (path: string) => `owlit://docs/${path.split("/").map(encodeURIComponent).join("/")}`
export const chatUri = (id: string) => `owlit://chat/${id}`
// A collection, or one of its groups: owlit://collections/c-replay#group=eval
export const collectionUri = (id: string, group?: string) => `owlit://collections/${id}${group ? `#group=${encodeURIComponent(group)}` : ""}`

export type OwlitUri =
  // owlit://library/p6#passage=tf-filter, #abstract or #p12 (a page)
  | { kind: "paper"; id: string; passage?: string; abstract?: boolean; page?: number }
  | { kind: "doc"; path: string }
  | { kind: "chat"; id: string }
  | { kind: "collection"; id: string; group?: string }
  // owlit://settings/<section> and owlit://shortcuts open over the page
  | { kind: "settings"; section?: string }
  | { kind: "shortcuts" }

const decode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Doc path from its encoded form: owlit://docs/writing/Related%20work.md → "writing/Related work.md"
const docPath = (encoded: string) => encoded.split("/").map(decode).join("/")

export function parseOwlitUri(uri: string): OwlitUri | null {
  const m = /^owlit:\/\/([a-z]+)(?:\/([^#]*))?(?:#(.*))?$/.exec(uri)
  if (!m) return null
  const [, kind, rest = "", frag = ""] = m
  if (kind === "library" && rest) {
    if (frag === "abstract") return { kind: "paper", id: rest, abstract: true }
    const passage = /^passage=(.+)$/.exec(frag)?.[1]
    if (passage) return { kind: "paper", id: rest, passage }
    const page = /^p(\d+)$/.exec(frag)?.[1]
    return page ? { kind: "paper", id: rest, page: Number(page) } : { kind: "paper", id: rest }
  }
  if (kind === "docs" && rest) return { kind: "doc", path: docPath(frag ? `${rest}#${frag}` : rest) }
  if (kind === "chat" && rest) return { kind: "chat", id: rest }
  if (kind === "collections" && rest) {
    const group = /^group=(.+)$/.exec(frag)?.[1]
    return group ? { kind: "collection", id: rest, group: decode(group) } : { kind: "collection", id: rest }
  }
  if (kind === "settings" && /^[a-z]*\/?$/.test(rest) && !frag) return { kind: "settings", section: rest.replace(/\/$/, "") || undefined }
  if (kind === "shortcuts" && !rest && !frag) return { kind: "shortcuts" }
  return null
}

// A mention as Markdown writes it: [label](owlit://library|docs|collections/…), the label's brackets
// escaped. Other owlit:// links, such as a quote's page link back to its highlight, are ordinary links.
export const MENTION_LINK = /\[((?:\\.|[^\]\\])+)\]\((owlit:\/\/(?:library|docs|collections)\/[^)\s]+)\)/
