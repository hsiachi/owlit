import { t } from "@lingui/core/macro"
import type { Mentionable } from "@/features/chat/types"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"
import { authorsYear, citationLabel } from "@/features/library/lib/format"
import { hasAllWords, queryWords } from "@/lib/words"
import { paperUri, parseOwlitUri } from "@owlit/protocol"
import { whenReaderReady } from "@/features/library/reader/reader-store"
import { fileAt, useDocsStore } from "../store"
import { knowledgeMentionables, knowledgeRoute, knowledgeTitle } from "@/features/knowledge/mentions"
import { isHidden } from "./tree"
import { useWorkspace } from "@/lib/workspace"
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

// The paper a link names, by its id or one of its earlier ids (a paper merged into another keeps answering
// to the id the agent was given); undefined when it isn't in the library
function paperOf(id: string) {
  const { papers, aliases } = useLibraryStore.getState()
  return papers[id] ?? (aliases[id] ? papers[aliases[id]] : undefined)
}

// Where a mention leads inside the app
export function mentionRoute(uri: string): string | null {
  const u = parseOwlitUri(uri)
  if (u?.kind === "paper") return `/library/${paperOf(u.id)?.id ?? u.id}${u.passage ? `?passage=${encodeURIComponent(u.passage)}` : ""}`
  if (u?.kind === "knowledge") return knowledgeRoute(u)
  if (u?.kind === "chat") return `/chat/${u.id}`
  if (u?.kind !== "doc") return null
  const file = fileAt(u.path)
  return file ? `/docs/${file.id}` : null
}

// macOS's /tmp, /var and /etc are links into /private: core holds the real path, an agent may write
// either
const macAliases = (root: string) => {
  const m = /^(?:\/private)?(\/(?:tmp|var|etc)\/.*)$/.exec(root)
  return m ? [m[1], `/private${m[1]}`] : []
}

// A link an agent wrote to a file of the workspace by its path (absolute, file://, or from the
// workspace's folder, maybe with a :line after it), as that file's owlit:// address, so it opens here
// rather than in the browser; null for a web link or a path that names nothing in the workspace
export function docUriOfLink(href: string): string | null {
  let path: string
  if (/^file:\/\//i.test(href)) {
    try {
      path = decodeURIComponent(new URL(href).pathname)
    } catch {
      return null
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) return null
  else {
    path = href.replace(/[?#].*$/, "")
    try {
      path = decodeURIComponent(path)
    } catch {
      // Left as written
    }
  }
  path = path.replace(/:\d+(?::\d+)?$/, "")
  const root = useWorkspace.getState().current?.path
  const inside = root && [root, ...macAliases(root)].find((r) => path.startsWith(`${r}/`))
  if (inside) path = path.slice(inside.length + 1)
  else if (path.startsWith("/")) return null
  const file = fileAt(path.replace(/^\.\//, ""))
  return file ? docUri(file.path) : null
}

// The name a mention shows when its text is empty
export function mentionTitle(uri: string): string | undefined {
  const u = parseOwlitUri(uri)
  if (u?.kind === "knowledge") return knowledgeTitle(u)
  return u?.kind === "paper" ? paperOf(u.id)?.title : undefined
}

// What a mention does when clicked, for its tooltip: a page link says where it goes ("Jacovi et al. 2025,
// p. 5"), since its own text is often just "p5"; any other link shows the paper's title
export function mentionTooltip(uri: string): string | undefined {
  const u = parseOwlitUri(uri)
  return (u?.kind === "paper" && u.page ? mentionLabel(uri) : undefined) ?? mentionTitle(uri)
}

// Opens what a mention points at. A page link (owlit://library/<id>#p5) goes to the paper and, once its
// reader has laid out its pages, scrolls to that page; when the paper is already open beside the chat the
// route doesn't change, so only the scroll happens. `go` is the caller's navigation (it may also dock the
// chat the link was in); it is skipped when the page is already the one shown, so a click leaves no extra
// history entry.
export function openMention(uri: string, go: (route: string) => void, pathname = window.location.pathname) {
  const to = mentionRoute(uri)
  if (!to) return
  if (to !== pathname) go(to)
  const u = parseOwlitUri(uri)
  if (u?.kind !== "paper" || !u.page) return
  const paper = paperOf(u.id)
  if (!paper) return
  const page = u.page
  // A paper without a PDF never gets ready; the link has still opened it
  whenReaderReady(paper.id).then((api) => api.showPage(page - 1), () => undefined)
}

// A short name for a bare owlit:// address in prose an agent wrote (a note's text): how a writer cites
// it, "Chan et al. 2026, p. 13", or a doc's file name. Undefined when the address names nothing here.
export function mentionLabel(uri: string): string | undefined {
  const u = parseOwlitUri(uri)
  if (u?.kind === "paper") {
    const paper = paperOf(u.id)
    if (!paper) return undefined
    const cite = citationLabel(paper)
    const page = u.page
    return page ? t({ message: `${cite}, p. ${page}`, comment: "a paper cited at a page: Chan et al. 2026, p. 13" }) : cite
  }
  if (u?.kind === "doc") return u.path.split("/").pop()?.replace(/\.md$/, "")
  if (u?.kind === "knowledge") return knowledgeTitle(u)
  return undefined
}
