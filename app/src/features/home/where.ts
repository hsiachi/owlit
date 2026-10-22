import { useCallback, useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useChatStore } from "@/features/chat/store"
import { useDocsStore } from "@/features/docs/store"
import { parentPath } from "@/features/docs/types"
import { projectAt, useProjects } from "@/features/projects/store"
import { useLibraryStore } from "@/features/library/store"
import { authorsYear } from "@/features/library/lib/format"
import { useThreadsStore } from "@/features/threads/store"
import { markdownPlain } from "@/lib/markdown-plain"
import { isOwlit, parseOwlitUri, type Change, type Project } from "@owlit/protocol"
import { listChanges, useLogVersion, useSeen } from "@/app/seen"
import { nameOf, useMe } from "@/lib/actors"
import { useTrail, workspaceKey } from "./trail"
import { chatPlace, docPlaces, lastParagraph, placeNews, threadPlace, type News, type Place } from "./places"

export type { News, Place } from "./places"

// Home's places from the stores, kept current (places.ts says what counts as one)

// The change log's entries for one kind, newest first; asked again whenever the log gained an entry
function useChanges(kind: "doc" | "thread") {
  const version = useLogVersion((s) => s.version)
  const [changes, setChanges] = useState<Change[]>([])
  useEffect(() => {
    let live = true
    listChanges({ target: { kind } }).then(
      (list) => live && setChanges(list),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [version, kind])
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
  const changes = useChanges("doc")
  const threadChanges = useChanges("thread")
  const me = useMe()

  // One list per kind, so a streamed reply doesn't requote every doc
  const docs = useMemo(() => docPlaces(Object.values(files), marks ?? [], changes, me), [files, marks, changes, me])
  const projects = useProjects()
  const threadPlaces = useMemo(() => {
    // The person's own newest change to each thread
    const mine = new Map<string, number>()
    for (const c of threadChanges) if (c.actor === me && !mine.has(c.target.path)) mine.set(c.target.path, c.until ?? c.at)
    const name = (path: string) => projectAt(projects, path)?.name ?? ""
    return Object.values(threads).map((c) => threadPlace(c, mine.get(c.id), name))
  }, [threads, threadChanges, me, projects])

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

// The marked project a place is in: a doc's by its path (the nearest mark above it), a thread's by its
// project field, a chat's by the project the person put it in, else by the first doc or thread its
// messages name (core's projectsOf also reads the change log, too much to ask for every row). A paper is in
// none here, since only the docs citing it would say which.
export function useProjectOfPlace(): (place: Place) => Project | undefined {
  const projects = useProjects()
  const chats = useChatStore((s) => s.chats)
  const threads = useThreadsStore((s) => s.threads)
  return useCallback(
    (place: Place) => {
      const ofDoc = (path: string) => {
        for (let p = parentPath(path); p; p = parentPath(p)) {
          const project = projectAt(projects, p)
          if (project) return project
        }
        return undefined
      }
      const ofThread = (id: string) => projectAt(projects, threads[id]?.project ?? "")
      if (place.kind === "doc") return ofDoc(place.id)
      if (place.kind === "thread") return ofThread(place.id)
      if (place.kind !== "chat") return undefined
      const chat = chats[place.id]
      if (!chat) return undefined
      const chosen = projectAt(projects, chat.project ?? "")
      if (chosen) return chosen
      for (const m of chat.messages)
        for (const x of [...(m.mentions ?? []), ...(m.context ?? []), ...(m.selection ? [m.selection.source] : [])]) {
          const u = parseOwlitUri(x.uri)
          const project = u?.kind === "doc" ? ofDoc(u.path) : u?.kind === "thread" ? ofThread(u.id) : undefined
          if (project) return project
        }
      return undefined
    },
    [projects, chats, threads],
  )
}

// What came to the place since the user last looked, kept current
export function useNews(place: Place): News | null {
  const unseen = useSeen((s) => s.unseen)
  return useMemo(() => placeNews(place, unseen, nameOf), [place, unseen])
}
