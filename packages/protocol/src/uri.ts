// owlit:// addresses: how a paper, doc, Knowledge topic or chat is linked in Markdown, by agents and the
// window alike. Doc paths and topic ids are percent-encoded; paper and chat ids are plain.

export const paperUri = (id: string, passage?: string) => `owlit://library/${id}${passage ? `#passage=${passage}` : ""}`
export const docUri = (path: string) => `owlit://docs/${path.split("/").map(encodeURIComponent).join("/")}`
// A block is a line or question inside the topic file, by its Obsidian block id: owlit://knowledge/when-to-call#^q1
export const topicUri = (id: string, block?: string) => `owlit://knowledge/${encodeURIComponent(id)}${block ? `#^${block}` : ""}`
export const chatUri = (id: string) => `owlit://chat/${id}`

export type OwlitUri =
  // owlit://library/p6#passage=tf-filter, #abstract or #p12 (a page)
  | { kind: "paper"; id: string; passage?: string; abstract?: boolean; page?: number }
  | { kind: "doc"; path: string }
  | { kind: "knowledge"; topicId: string; block?: string }
  | { kind: "chat"; id: string }
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
  if (kind === "knowledge" && rest) return { kind: "knowledge", topicId: decode(rest), block: frag.replace(/^\^/, "") || undefined }
  if (kind === "chat" && rest) return { kind: "chat", id: rest }
  if (kind === "settings" && /^[a-z]*\/?$/.test(rest) && !frag) return { kind: "settings", section: rest.replace(/\/$/, "") || undefined }
  if (kind === "shortcuts" && !rest && !frag) return { kind: "shortcuts" }
  return null
}

// A mention as Markdown writes it: [label](owlit://library|docs|knowledge/…), the label's brackets
// escaped. Other owlit:// links, such as a quote's page link back to its highlight, are ordinary links.
export const MENTION_LINK = /\[((?:\\.|[^\]\\])+)\]\((owlit:\/\/(?:library|docs|knowledge)\/[^)\s]+)\)/
