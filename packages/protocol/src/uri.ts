// owlit:// addresses: how a paper, doc, thread or chat is linked in Markdown, by agents and the
// window alike. Doc paths are percent-encoded; paper, thread and chat ids are plain.

export const paperUri = (id: string, passage?: string) => `owlit://library/${id}${passage ? `#passage=${passage}` : ""}`
export const docUri = (path: string) => `owlit://docs/${path.split("/").map(encodeURIComponent).join("/")}`
export const chatUri = (id: string) => `owlit://chat/${id}`
// A thread, or one of its groups: owlit://threads/t-replay#group=eval
export const threadUri = (id: string, group?: string) => `owlit://threads/${id}${group ? `#group=${encodeURIComponent(group)}` : ""}`

// A mention's Markdown, [label](uri), the label's brackets and backslashes escaped so any title survives
// as link text; unescapeLabel takes a label back
export const mentionLink = (label: string, uri: string) => `[${label.replace(/([[\]\\])/g, "\\$1")}](${uri})`
// A claim about a paper as Owlit writes it everywhere (agents/rules.ts): the page in the fragment, the
// sentence it rests on as the link's title, on one line (a quote from a PDF keeps its line breaks, and a
// blank line inside a title ends the link)
export const citationLink = (label: string, id: string, passage: { quote: string; page: number }) =>
  `${mentionLink(label, `owlit://library/${id}#p${passage.page}`).slice(0, -1)} "${passage.quote.replace(/\s+/g, " ").trim().replace(/["\\]/g, "\\$&")}")`
// A Markdown link title as written ("…", '…' or (…)) as its words, its backslash escapes undone
export const linkTitleText = (raw: string) => raw.trim().slice(1, -1).replace(/\\(.)/g, "$1")
export const unescapeLabel = (label: string) => label.replace(/\\([[\]\\])/g, "$1")

export type OwlitUri =
  // owlit://library/p6#passage=tf-filter, #abstract or #p12 (a page)
  | { kind: "paper"; id: string; passage?: string; abstract?: boolean; page?: number }
  | { kind: "doc"; path: string }
  | { kind: "chat"; id: string }
  | { kind: "thread"; id: string; group?: string }
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
  if (kind === "threads" && rest) {
    const group = /^group=(.+)$/.exec(frag)?.[1]
    return group ? { kind: "thread", id: rest, group: decode(group) } : { kind: "thread", id: rest }
  }
  if (kind === "settings" && /^[a-z]*\/?$/.test(rest) && !frag) return { kind: "settings", section: rest.replace(/\/$/, "") || undefined }
  if (kind === "shortcuts" && !rest && !frag) return { kind: "shortcuts" }
  return null
}

// A mention as Markdown writes it: [label](owlit://library|docs|threads/…), the label's brackets
// escaped. Other owlit:// links, such as a quote's page link back to its highlight, are ordinary links.
export const MENTION_LINK = /\[((?:\\.|[^\]\\])+)\]\((owlit:\/\/(?:library|docs|threads)\/[^)\s]+)\)/
