import { isOwlit } from "@owlit/protocol"
import { useEffect } from "react"
import { isLibraryFromCore, markReading } from "../disk"
import { useLibraryStore } from "../store"

// When opening a paper counts as reading it. A paper becomes Reading, and its last-read time (lastOpenedAt,
// which orders Home's recent papers and the ⌘K list) moves, only once the person has really read in it:
// 45 seconds on the paper with the window in view, a move past the page the reader opened on (a scroll or
// a page change), or a highlight, a comment or a note of their own. A glance changes nothing but the
// remembered position: a paper opened for ten seconds would otherwise turn Reading and come before the
// paper the person is half-way through. Read comes from core, when the person reaches the end (core's
// activity/reading.ts › readInFull).
const READ_AFTER_MS = 45_000

// The paper open now, and whether this visit has counted yet: it counts once
let visit: { paperId: string; counted: boolean } | null = null

// The person has read in the paper open now (the reader calls this when they move past the first page)
export function readInPaper(paperId: string) {
  if (!visit || visit.paperId !== paperId || visit.counted) return
  visit.counted = true
  markReading(paperId)
}

// One visit to a paper's page: the clock, and the person's own marks, while it is open
export function useReadingVisit(paperId: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const here = { paperId, counted: false }
    visit = here
    // Only time with the window in view counts, a second at a time
    let seen = 0
    const tick = setInterval(() => {
      if (document.visibilityState !== "visible") return
      seen += 1000
      if (seen >= READ_AFTER_MS) readInPaper(paperId)
    }, 1000)
    // A highlight, a comment or a note the person made here; not what core or an agent wrote
    const off = useLibraryStore.subscribe((s, prev) => {
      if (here.counted || isLibraryFromCore()) return
      if (s.notes[paperId] !== prev.notes[paperId] && s.notes[paperId]?.content.trim()) readInPaper(paperId)
      else if (s.highlights !== prev.highlights) {
        for (const h of Object.values(s.highlights)) {
          if (h.paperId !== paperId || isOwlit(h.addedBy) || prev.highlights[h.id] === h) continue
          readInPaper(paperId)
          break
        }
      }
    })
    return () => {
      clearInterval(tick)
      off()
      if (visit === here) visit = null
    }
  }, [paperId, enabled])
}
