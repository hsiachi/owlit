import { useMemo } from "react"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { displayName, isMarkdown, parentPath } from "@/features/docs/types"
import { useLibraryStore } from "@/features/library/store"
import { shortAuthors } from "@/features/library/lib/format"
import { shortDate } from "@/features/knowledge/lib/when"
import { useTrail, workspaceKey } from "./trail"

// "Where was I": everything the user did something in, newest first, across docs, chats and papers.
// A doc counts once written in, a chat once the user sent something, a paper once opened to read,
// highlighted or noted. Topic files are Owlit's, so they belong to Knowledge, not here.

export type Kind = "doc" | "chat" | "paper"

export interface Place {
  kind: Kind
  key: string
  title: string
  // Muted text after the title: the doc's folder, the paper's authors and year
  detail: string
  at: number
  to: string
  // The user's own last words there: the paragraph the cursor was in, their last message, their last
  // highlight or note. Never reading progress.
  words?: string
  // What the time means for this kind ("edited", "read")
  did: string
}

// Markdown read as plain words: links and mentions keep their label, marks go
export function plain(text: string) {
  return text
    .replace(/!?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, name, label) => label ?? name)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ x]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*)[*_](?=\W|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
}

// The paragraph around an offset: the run of non-blank lines that holds it
function paragraphAt(text: string, head: number) {
  const at = Math.min(Math.max(head, 0), text.length)
  const start = text.lastIndexOf("\n\n", Math.max(at - 1, 0))
  const end = text.indexOf("\n\n", at)
  const words = plain(text.slice(start < 0 ? 0 : start + 2, end < 0 ? text.length : end))
  return words || undefined
}

const lastParagraph = (text: string) => plain(text.trim().split(/\n\s*\n/).at(-1) ?? "") || undefined

export function usePlaces(): Place[] {
  const files = useDocsStore((s) => s.files)
  const chats = useChatStore((s) => s.chats)
  const papers = useLibraryStore((s) => s.papers)
  const highlights = useLibraryStore((s) => s.highlights)
  const notes = useLibraryStore((s) => s.notes)
  const marks = useTrail((s) => s.docs[workspaceKey()])

  return useMemo(() => {
    const out: Place[] = []
    const markByPath = new Map((marks ?? []).map((m) => [m.path, m]))

    for (const f of Object.values(files)) {
      if (!isMarkdown(f.path) || f.path.startsWith("knowledge/")) continue
      const mark = markByPath.get(f.path)
      out.push({
        kind: "doc",
        key: `doc:${f.id}`,
        title: displayName(f.path),
        detail: parentPath(f.path).split("/").at(-1) ?? "",
        at: Math.max(mark?.at ?? 0, f.modifiedAt),
        to: `/docs/${f.id}`,
        // Without a cursor to go by, the end of the doc: drafts grow at the bottom
        words: f.content ? (mark ? paragraphAt(f.content, mark.head) : lastParagraph(f.content)) : undefined,
        did: "edited",
      })
    }

    for (const c of Object.values(chats)) {
      const mine = c.messages.findLast((m) => m.role === "user")
      if (!mine) continue
      const text = mine.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join(" ")
      out.push({ kind: "chat", key: `chat:${c.id}`, title: c.title, detail: "", at: mine.createdAt, to: `/chat/${c.id}`, words: plain(text) || undefined, did: "" })
    }

    const lastMark = new Map<string, { at: number; words: string }>()
    for (const h of Object.values(highlights)) {
      if (h.addedBy === "agent") continue
      const words = h.comment ? `“${plain(h.text)}” ${h.comment}` : `“${plain(h.text)}”`
      if ((lastMark.get(h.paperId)?.at ?? 0) < h.createdAt) lastMark.set(h.paperId, { at: h.createdAt, words })
    }
    for (const n of Object.values(notes)) {
      const words = n.content.trim() ? lastParagraph(n.content) : undefined
      if (words && (lastMark.get(n.paperId)?.at ?? 0) < n.updatedAt) lastMark.set(n.paperId, { at: n.updatedAt, words })
    }
    for (const p of Object.values(papers)) {
      const mark = lastMark.get(p.id)
      const at = Math.max(p.lastOpenedAt ?? 0, mark?.at ?? 0)
      if (!at) continue
      out.push({
        kind: "paper",
        key: `paper:${p.id}`,
        title: p.title,
        detail: [shortAuthors(p.authors), p.year].filter(Boolean).join(" · "),
        at,
        to: `/library/${p.id}`,
        words: mark?.words,
        did: "read",
      })
    }

    return out.sort((a, b) => b.at - a.at)
  }, [files, chats, papers, highlights, notes, marks])
}

// "Just now", "12 min ago", "3 h ago", "Yesterday", then the date
export function when(t: number, now = Date.now()) {
  const d = now - t
  if (d < 60_000) return "Just now"
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`
  const today = new Date(now).setHours(0, 0, 0, 0)
  if (t >= today || d < 12 * 3_600_000) return `${Math.floor(d / 3_600_000)} h ago`
  if (t >= today - 86_400_000) return "Yesterday"
  return shortDate(t)
}
