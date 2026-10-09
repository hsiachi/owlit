import type { Mentionable } from "@/features/chat/types"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"
import { useDocsStore } from "../store"
import { knowledgeMentionables, knowledgeRoute, knowledgeTitle } from "@/features/knowledge/mentions"
import { isHidden } from "./tree"
import { displayName, docUri, isMarkdown, parentPath, type WorkspaceFile } from "../types"

// What a mention says in prose. A paper is cited the way a writer would: "Vaswani et al. 2017".
export interface DocMention extends Mentionable {
  label: string
}

const lastName = (author: string) => author.trim().split(/\s+/).pop() ?? author

export function shortCite(paper: Pick<Paper, "authors" | "year">) {
  const [a, b] = paper.authors
  const who = !a ? "Unknown" : paper.authors.length === 1 ? lastName(a) : paper.authors.length === 2 ? `${lastName(a)} and ${lastName(b)}` : `${lastName(a)} et al.`
  return paper.year ? `${who} ${paper.year}` : who
}

export { docUri }

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
  subtitle: shortCite(paper).replace(/ (\d{4})$/, " · $1"),
  uri: `owlit://library/${paper.id}`,
})

// Everything @ can point to from a doc, minus the doc itself
export function docMentionItems(query: string, selfId?: string): DocMention[] {
  const papers: DocMention[] = Object.values(useLibraryStore.getState().papers)
    .sort((x, y) => (y.lastOpenedAt ?? y.addedAt) - (x.lastOpenedAt ?? x.addedAt))
    .map((p) => ({ ...paperMentionable(p), label: shortCite(p) }))
  const docs: DocMention[] = Object.values(useDocsStore.getState().files)
    .filter((f) => f.id !== selfId && isMarkdown(f.path) && !isHidden(f.path))
    .sort((x, y) => y.modifiedAt - x.modifiedAt)
    .map((f) => ({ ...docMentionable(f), label: displayName(f.path) }))
  const items = [...papers, ...docs, ...knowledgeMentionables().map((k) => ({ ...k, label: k.title }))]

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter((m) => {
    const hay = `${m.title} ${m.subtitle ?? ""} ${m.label}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

// Where a mention leads inside the app
export function mentionRoute(uri: string): string | null {
  const m = /^owlit:\/\/(library|docs|knowledge|chat)\/(.+)$/.exec(uri)
  if (!m) return null
  if (m[1] === "library") {
    // A paper passage opens the paper at it: owlit://library/p6#passage=tf-cost
    const [id, frag] = m[2].split("#")
    const passage = /^passage=(.+)$/.exec(frag ?? "")?.[1]
    return `/library/${id}${passage ? `?passage=${encodeURIComponent(passage)}` : ""}`
  }
  if (m[1] === "knowledge") return knowledgeRoute(uri)
  if (m[1] === "chat") return `/chat/${m[2]}`
  const path = m[2].split("/").map(decodeURIComponent).join("/")
  const file = Object.values(useDocsStore.getState().files).find((f) => f.path === path)
  return file ? `/docs/${file.id}` : null
}

// The name a mention shows when its text is empty
export function mentionTitle(uri: string): string | undefined {
  if (uri.startsWith("owlit://knowledge/")) return knowledgeTitle(uri)
  const m = /^owlit:\/\/library\/([^#]+)/.exec(uri)
  return m ? useLibraryStore.getState().papers[m[1]]?.title : undefined
}
