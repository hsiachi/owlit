import { useEffect, useRef, useState } from "react"
import { markSeen, threadDots, useSeen } from "@/app/seen"

// After this long on screen, what Owlit changed counts as seen; its dots stay for this visit
export const SEEN_AFTER_MS = 1500

// Whether an item carries Owlit's dot on this visit: unseen when the visit began or since, and kept until
// the user leaves, after it has been marked seen too. The page is mounted once per thread visited.
export function useVisitDots(threadId: string | undefined) {
  const [visit, setVisit] = useState<ReadonlySet<string>>(() => new Set(threadId ? threadDots(useSeen.getState().unseen, threadId) : []))
  useEffect(() => {
    if (!threadId) return
    return useSeen.subscribe((s, prev) => {
      if (s.unseen === prev.unseen) return
      const items = threadDots(s.unseen, threadId)
      setVisit((v) => (items.every((i) => v.has(i)) ? v : new Set([...v, ...items])))
    })
  }, [threadId])
  return (item: string) => visit.has(item)
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
