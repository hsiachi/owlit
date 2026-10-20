import { plural, t } from "@lingui/core/macro"
import { useThreadsStore } from "@/features/threads/store"
import { threadHolding, shown } from "@/features/threads/lib"
import { isOwlit, type Mentionable, type Paper, paperUri, parseOwlitUri, type ThreadRead, threadUri } from "@owlit/protocol"
import { paperById, useLibraryStore } from "@/features/library/store"
import { authorsYear, citationLabel } from "@/features/library/lib/format"
import { hasAllWords, queryWords } from "@/lib/words"
import { showInPaper } from "@/features/library/paper-view"
import { fileAt, useDocsStore } from "../store"
import { isHidden } from "./tree"
import { useWorkspace } from "@/lib/workspace"
import { i18n } from "@/lib/i18n"
import { displayName, docUri, isMarkdown, parentPath, type WorkspaceFile } from "../types"

// What a mention says in prose. A paper is cited the way a writer would: "Vaswani et al. 2017".
export interface DocMention extends Mentionable {
  label: string
}

// A doc, paper or thread as something the agent can be pointed at
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

export const threadMentionable = (c: ThreadRead): Mentionable => {
  const { title, rows } = shown(c)
  return { id: c.id, kind: "thread", title, subtitle: plural(rows.length, { one: "# paper", other: "# papers" }), uri: threadUri(c.id) }
}

// Everything @ can point to, built again only when the papers, docs, threads or language changed, as
// @ asks for it on every key typed. Shared between callers, so not to be changed.
let everything: { from: unknown[]; items: DocMention[] } | undefined
function everyMention(): DocMention[] {
  const { papers, aliases } = useLibraryStore.getState()
  const { files } = useDocsStore.getState()
  const { threads } = useThreadsStore.getState()
  const from = [papers, aliases, files, threads, i18n.locale]
  if (everything?.from.every((x, i) => x === from[i])) return everything.items
  const paperItems: DocMention[] = Object.values(papers)
    .sort((x, y) => (y.lastOpenedAt ?? y.addedAt) - (x.lastOpenedAt ?? x.addedAt))
    .map((p) => ({ ...paperMentionable(p), label: citationLabel(p) }))
  const docItems: DocMention[] = Object.values(files)
    .filter((f) => isMarkdown(f.path) && !isHidden(f.path))
    .sort((x, y) => y.modifiedAt - x.modifiedAt)
    .map((f) => ({ ...docMentionable(f), label: displayName(f.path) }))
  // The threads, most recently changed first
  const threadItems: DocMention[] = Object.values(threads)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => {
      const m = threadMentionable(c)
      return { ...m, label: m.title }
    })
  // Papers a thread found that aren't in the Library, each once, from the threads changed last: linked by
  // the id the thread knows them by, as its rows link them (mentionRoute opens one on its thread)
  const found = new Map<string, DocMention>()
  for (const c of Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt)) {
    const thread = shown(c)
    const where = thread.title
    for (const row of thread.rows) {
      if (found.has(row.id) || paperOf(row.id, papers, aliases)) continue
      const who = authorsYear(row.paper)
      found.set(row.id, {
        id: row.id,
        kind: "paper",
        title: row.paper.title,
        subtitle: t({ message: `${who} · in “${where}”`, comment: "a paper @ offers from a thread: its authors and year, and the thread that found it" }),
        uri: paperUri(row.id),
        label: citationLabel(row.paper),
      })
    }
  }
  everything = { from, items: [...paperItems, ...docItems, ...threadItems, ...found.values()] }
  return everything.items
}

// Everything @ can point to from a doc, minus the doc itself
export function allDocMentions(selfId?: string): DocMention[] {
  const all = everyMention()
  return selfId ? all.filter((m) => !(m.kind === "doc" && m.id === selfId)) : all
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
function paperOf(id: string, papers = useLibraryStore.getState().papers, aliases = useLibraryStore.getState().aliases) {
  return paperById(papers, aliases, id)
}

// A paper mention whose paper Owlit added and the person hasn't opened (still Unread): drawn lighter until
// they do (lib/reading.ts turns it Reading). A paper the person imported or added themselves is theirs and
// drawn as usual, read here or not (they may have read it years ago); so is one outside the library.
export function paperUnread(uri: string, papers = useLibraryStore.getState().papers, aliases = useLibraryStore.getState().aliases): boolean {
  const u = parseOwlitUri(uri)
  const paper = u?.kind === "paper" ? paperOf(u.id, papers, aliases) : undefined
  return !!paper?.addedBy && isOwlit(paper.addedBy) && paper.status === "unread"
}

// The same, kept current as the paper is read
export const usePaperUnread = (uri: string | null | undefined) => useLibraryStore((s) => !!uri && paperUnread(uri, s.papers, s.aliases))

// Where a mention leads inside the app
export function mentionRoute(uri: string): string | null {
  const u = parseOwlitUri(uri)
  if (u?.kind === "paper") {
    const paper = paperOf(u.id)
    // A paper Owlit found and the user hasn't taken in lives on its thread: the link opens it there
    if (!paper) {
      const holder = threadHolding(useThreadsStore.getState().threads, u.id)
      if (holder) return `/threads/${holder.id}?paper=${encodeURIComponent(u.id)}`
    }
    return `/library/${paper?.id ?? u.id}`
  }
  if (u?.kind === "chat") return `/chat/${u.id}`
  if (u?.kind === "thread") return `/threads/${u.id}`
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
  if (u?.kind === "thread") return threadTitle(u.id)
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
export function openMention(uri: string, go: (route: string) => void, pathname = window.location.pathname, quote?: string) {
  const to = mentionRoute(uri)
  if (!to) return
  if (to !== pathname) go(to)
  const u = parseOwlitUri(uri)
  if (u?.kind !== "paper" || (!u.page && !quote)) return
  const paper = paperOf(u.id)
  if (!paper) return
  // A paper without a PDF has no page to go to; the link has still opened it. A citation that gave the sentence
  // it rests on (its link's title) rings that sentence; one that isn't found still lands on its page.
  showInPaper(paper.id, { page: u.page, quote }).catch(() => undefined)
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
  if (u?.kind === "doc") return displayName(u.path)
  if (u?.kind === "thread") return threadTitle(u.id)
  return undefined
}

const threadTitle = (id: string) => {
  const c = useThreadsStore.getState().threads[id]
  return c ? shown(c).title : undefined
}
