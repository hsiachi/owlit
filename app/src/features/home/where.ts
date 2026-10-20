import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { useLibraryStore } from "@/features/library/store"
import { authorsYear } from "@/features/library/lib/format"
import { useThreadsStore } from "@/features/threads/store"
import { markdownPlain } from "@/lib/markdown-plain"
import { isOwlit, type Change } from "@owlit/protocol"
import { listChanges, useSeen } from "@/app/seen"
import { nameOf, useMe } from "@/lib/actors"
import { useTrail, workspaceKey } from "./trail"
import { chatPlace, docPlaces, lastParagraph, placeNews, threadPlace, type News, type Place } from "./places"

export type { News, Place } from "./places"

// Home's places from the stores, kept current (places.ts says what counts as one)

// Each doc's entries in the change log, newest first; asked again whenever something new came
function useDocChanges() {
  const unseen = useSeen((s) => s.unseen)
  const [changes, setChanges] = useState<Change[]>([])
  useEffect(() => {
    let live = true
    listChanges({ target: { kind: "doc" } }).then(
      (list) => live && setChanges(list),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [unseen])
  return changes
}

export function usePlaces(): Place[] {
  const files = useDocsStore((s) => s.files)
  const chatPlaces = useChatStore(useShallow((s) => Object.values(s.chats).flatMap(chatPlace)))
  const papers = useLibraryStore((s) => s.papers)
  const highlights = useLibraryStore((s) => s.highlights)
  const notes = useLibraryStore((s) => s.notes)
  const threads = useThreadsStore((s) => s.threads)
  const marks = useTrail((s) => s.docs[workspaceKey()])
  const changes = useDocChanges()
  const me = useMe()

  // One list per kind, so a streamed reply doesn't requote every doc
  const docs = useMemo(() => docPlaces(Object.values(files), marks ?? [], changes, me), [files, marks, changes, me])
  const threadPlaces = useMemo(() => Object.values(threads).map(threadPlace), [threads])

  const paperPlaces = useMemo(() => {
    const out: Place[] = []
    const lastMark = new Map<string, { at: number; words: string }>()
    for (const h of Object.values(highlights)) {
      if (isOwlit(h.addedBy)) continue
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
      out.push({ kind: "paper", key: `paper:${p.id}`, id: p.id, title: p.title, detail: authorsYear(p), at, to: `/library/${p.id}`, words: mark?.words, did: "read" })
    }
    return out
  }, [papers, highlights, notes])

  return useMemo(() => [...docs, ...chatPlaces, ...paperPlaces, ...threadPlaces].sort((a, b) => b.at - a.at), [docs, chatPlaces, paperPlaces, threadPlaces])
}

// What came to the place since the user last looked, kept current
export function useNews(place: Place): News | null {
  const unseen = useSeen((s) => s.unseen)
  return useMemo(() => placeNews(place, unseen, nameOf), [place, unseen])
}
