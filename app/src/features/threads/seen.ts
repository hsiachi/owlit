import { readInFull, type Change } from "@owlit/protocol"
import { useEffect, useRef, useState } from "react"
import { listChanges, markSeen, threadDots, useSeen } from "@/app/seen"

// After this long on screen, what Owlit changed counts as seen; its dots stay for this visit
export const SEEN_AFTER_MS = 1500

export interface VisitDots {
  // Whether an item carries Owlit's dot on this visit
  fresh: (item: string) => boolean
  // The newest change behind that dot, for what the dot's place says besides (a cell rewritten in full)
  changeOf: (item: string) => Change | undefined
}

// Owlit's dots on this visit: on the items unseen when the visit began or since, and kept until the user
// leaves, after they have been marked seen too. The page is mounted once per thread visited.
export function useVisitDots(threadId: string | undefined): VisitDots {
  const [visit, setVisit] = useState<ReadonlyMap<string, Change>>(() => new Map(threadId ? threadChanges(useSeen.getState().unseen, threadId) : []))
  useEffect(() => {
    if (!threadId) return
    return useSeen.subscribe((s, prev) => {
      if (s.unseen === prev.unseen) return
      const items = threadChanges(s.unseen, threadId)
      setVisit((v) => (items.every(([item, c]) => v.get(item) === c) ? v : new Map([...v, ...items])))
    })
  }, [threadId])
  return { fresh: (item) => visit.has(item), changeOf: (item) => visit.get(item) }
}

// Each unseen item of the thread with its newest change (the log is newest first)
function threadChanges(unseen: Parameters<typeof threadDots>[0], threadId: string): [string, Change][] {
  const out = new Map<string, Change>()
  for (const c of unseen.changes) if (c.target.kind === "thread" && c.target.path === threadId && c.target.part && !out.has(c.target.part)) out.set(c.target.part, c)
  return [...out]
}

// What a cell's answer was before Owlit answered it again from the full text, when that is the newest
// change to the cell: asked of the log while wanted (a card open), so a cell seen long ago still says it.
// undefined until the log has answered.
export function useReadInFull(threadId: string, item: string, wanted: boolean): ReturnType<typeof readInFull> | undefined {
  const [was, setWas] = useState<{ item: string; found: ReturnType<typeof readInFull> } | null>(null)
  useEffect(() => {
    if (!wanted) return
    let live = true
    void listChanges({ target: { kind: "thread", path: threadId, part: item } }).then(
      (list) => live && setWas({ item, found: readInFull(list[0]) }),
      () => live && setWas({ item, found: null }),
    )
    return () => {
      live = false
    }
  }, [threadId, item, wanted])
  return was?.item === item ? was.found : undefined
}

// Marks a row's items seen once it has been on screen SEEN_AFTER_MS: a row never scrolled to keeps its dot.
// Watched only while one of them is unseen.
export function useSeenOnScreen<T extends Element>(threadId: string, items: string[]) {
  const ref = useRef<T>(null)
  const key = items.join(" ")
  const unseen = useSeen((s) => threadDots(s.unseen, threadId).some((item) => items.includes(item)))
  useEffect(() => {
    const el = ref.current
    if (!el || !unseen) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer)
      if (entry?.isIntersecting) timer = setTimeout(() => markSeen({ kind: "thread", id: threadId, items: key.split(" ") }), SEEN_AFTER_MS)
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      clearTimeout(timer)
    }
  }, [threadId, key, unseen])
  return ref
}
