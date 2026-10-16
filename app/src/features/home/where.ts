import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { baseName, displayName, isMarkdown, parentPath } from "@/features/docs/types"
import { useLibraryStore } from "@/features/library/store"
import { authorsYear } from "@/features/library/lib/format"
import { useTrail, workspaceKey } from "./trail"
import type { Kind } from "@/lib/kinds"
import { markdownPlain } from "@/lib/markdown-plain"
import { messageText } from "@/features/chat/lib/message-text"
import type { Chat, ChatMessage } from "@owlit/protocol"

// "Where was I": everything the user did something in, newest first, across docs, chats and papers.
// A doc counts once written in, a chat once the user sent something, a paper once opened to read,
// highlighted or noted.

export interface Place {
  kind: Extract<Kind, "doc" | "chat" | "paper">
  key: string
  title: string
  // Muted text after the title: the doc's folder, the paper's authors and year
  detail: string
  at: number
  to: string
  // The user's own last words there: the paragraph the cursor was in, their last message, their last
  // highlight or note. Never reading progress.
  words?: string
  // What the time means for this kind ("edited", "Owlit edited", "read"); Home words it, none for a chat
  did: Did | null
  // A paper's id, for the marks it can carry (a new digest)
  paperId?: string
}

export type Did = "edited" | "owlit-wrote" | "owlit-edited" | "read"

// The paragraph around an offset: the run of non-blank lines that holds it
function paragraphAt(text: string, head: number) {
  const at = Math.min(Math.max(head, 0), text.length)
  const start = text.lastIndexOf("\n\n", Math.max(at - 1, 0))
  const end = text.indexOf("\n\n", at)
  const words = markdownPlain(text.slice(start < 0 ? 0 : start + 2, end < 0 ? text.length : end))
  return words || undefined
}

// The doc's file is saved a moment after Owlit's change reaches an open editor; a later change than that
// was someone else's (an undo from the result card, another editor)
const SAVED_WITHIN = 30_000

// Whether the doc's last edit was Owlit's: "Owlit wrote" a doc it made that nobody has touched since,
// "Owlit edited" one it changed last; else "edited", the user's own
function owlitDid(createdAt: number, modifiedAt: number, owlitAt: number, userAt = 0): Did {
  if (owlitAt < userAt || modifiedAt > owlitAt + SAVED_WITHIN) return "edited"
  return !userAt && createdAt >= owlitAt - SAVED_WITHIN ? "owlit-wrote" : "owlit-edited"
}

const lastParagraph = (text: string) => markdownPlain(text.trim().split(/\n\s*\n/).at(-1) ?? "") || undefined

// A chat's place: the same object while its title and the user's last message stay the same, so a
// streamed reply (which leaves both alone) neither requotes the chat nor redraws Home
const chatPlaceCache = new Map<string, { mine: ChatMessage; place: Place }>()
function chatPlace(c: Chat): Place[] {
  const mine = c.messages.findLast((m) => m.role === "user")
  if (!mine) return []
  const was = chatPlaceCache.get(c.id)
  if (was && was.mine === mine && was.place.title === c.title) return [was.place]
  const words = markdownPlain(messageText(mine, " ")) || undefined
  const place: Place = { kind: "chat", key: `chat:${c.id}`, title: c.title, detail: "", at: mine.createdAt, to: `/chat/${c.id}`, words, did: null }
  chatPlaceCache.set(c.id, { mine, place })
  return [place]
}

export function usePlaces(): Place[] {
  const files = useDocsStore((s) => s.files)
  const chatPlaces = useChatStore(useShallow((s) => Object.values(s.chats).flatMap(chatPlace)))
  const papers = useLibraryStore((s) => s.papers)
  const highlights = useLibraryStore((s) => s.highlights)
  const notes = useLibraryStore((s) => s.notes)
  const marks = useTrail((s) => s.docs[workspaceKey()])
  const owlitMarks = useTrail((s) => s.owlitDocs[workspaceKey()])

  // One list per kind, so a streamed reply doesn't requote every doc
  const docPlaces = useMemo(() => {
    const out: Place[] = []
    const markByPath = new Map((marks ?? []).map((m) => [m.path, m]))
    const owlitByPath = new Map((owlitMarks ?? []).map((m) => [m.path, m.at]))
    for (const f of Object.values(files)) {
      if (!isMarkdown(f.path)) continue
      const mark = markByPath.get(f.path)
      const owlitAt = owlitByPath.get(f.path)
      out.push({
        kind: "doc",
        key: `doc:${f.id}`,
        title: displayName(f.path),
        detail: baseName(parentPath(f.path)),
        at: Math.max(mark?.at ?? 0, f.modifiedAt),
        to: `/docs/${f.id}`,
        // Without a cursor to go by, the end of the doc: drafts grow at the bottom
        words: f.content ? (mark ? paragraphAt(f.content, mark.head) : lastParagraph(f.content)) : undefined,
        did: owlitAt !== undefined ? owlitDid(f.createdAt, f.modifiedAt, owlitAt, mark?.at) : "edited",
      })
    }
    return out
  }, [files, marks, owlitMarks])

  const paperPlaces = useMemo(() => {
    const out: Place[] = []
    const lastMark = new Map<string, { at: number; words: string }>()
    for (const h of Object.values(highlights)) {
      if (h.addedBy === "agent") continue
      const words = h.comment ? `“${markdownPlain(h.text)}” ${h.comment}` : `“${markdownPlain(h.text)}”`
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
        detail: authorsYear(p),
        at,
        to: `/library/${p.id}`,
        words: mark?.words,
        did: "read",
        paperId: p.id,
      })
    }
    return out
  }, [papers, highlights, notes])

  return useMemo(() => [...docPlaces, ...chatPlaces, ...paperPlaces].sort((a, b) => b.at - a.at), [docPlaces, chatPlaces, paperPlaces])
}
