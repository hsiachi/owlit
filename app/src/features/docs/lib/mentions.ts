import { knowledge } from "@/features/chat/mocks/sources"
import type { Mentionable } from "@/features/chat/types"
import { useLibraryStore } from "@/features/library/store"
import type { Paper } from "@/features/library/types"
import { useDocsStore } from "../store"
import { displayName, isMarkdown, parentPath } from "../types"

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

export const docUri = (path: string) => `owlit://docs/${path.split("/").map(encodeURIComponent).join("/")}`

// Everything @ can point to from a doc, minus the doc itself
export function docMentionItems(query: string, selfId?: string): DocMention[] {
  const papers: DocMention[] = Object.values(useLibraryStore.getState().papers)
    .sort((x, y) => (y.lastOpenedAt ?? y.addedAt) - (x.lastOpenedAt ?? x.addedAt))
    .map((p) => ({
      id: p.id,
      kind: "paper",
      title: p.title,
      subtitle: shortCite(p).replace(/ (\d{4})$/, " · $1"),
      uri: `owlit://library/${p.id}`,
      label: shortCite(p),
    }))
  const docs: DocMention[] = Object.values(useDocsStore.getState().files)
    .filter((f) => f.id !== selfId && isMarkdown(f.path))
    .sort((x, y) => y.modifiedAt - x.modifiedAt)
    .map((f) => ({ id: f.id, kind: "doc", title: displayName(f.path), subtitle: parentPath(f.path) || undefined, uri: docUri(f.path), label: displayName(f.path) }))
  const items = [...papers, ...docs, ...knowledge.map((k) => ({ ...k, label: k.title }))]

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter((m) => {
    const hay = `${m.title} ${m.subtitle ?? ""} ${m.label}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

// Where a mention leads inside the app
export function mentionRoute(uri: string): string | null {
  const m = /^owlit:\/\/(library|docs|knowledge)\/(.+)$/.exec(uri)
  if (!m) return null
  if (m[1] === "library") return `/library/${m[2]}`
  if (m[1] === "knowledge") return "/knowledge"
  const path = m[2].split("/").map(decodeURIComponent).join("/")
  const file = Object.values(useDocsStore.getState().files).find((f) => f.path === path)
  return file ? `/docs/${file.id}` : null
}

// The name a mention shows when its text is empty
export function mentionTitle(uri: string): string | undefined {
  const m = /^owlit:\/\/library\/(.+)$/.exec(uri)
  return m ? useLibraryStore.getState().papers[m[1]]?.title : undefined
}
