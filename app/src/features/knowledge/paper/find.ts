import { useLibraryStore } from "@/features/library/store"
import { useReaderStore } from "@/features/library/reader/reader-store"
import { addPassage, useKnowledgeStore } from "../store"

// "Find it in the paper" for a line taken from the abstract alone: the reader selects the likeliest passage
// with the highlight popover open. Whatever the user highlights next in that paper becomes the line's
// passage, and Owlit rewrites the line from it once the paper is closed.

let pending: { paperId: string; topicId: string; lineId: string } | null = null

export async function findInPaper(paperId: string, topicId: string, lineId: string) {
  pending = { paperId, topicId, lineId }
  const k = useKnowledgeStore.getState().paper(paperId)
  const likely = k.likely?.[`${topicId}/${lineId}`]
  const passage = likely ? k.passages[likely] : undefined
  const api = useReaderStore.getState().api
  if (!passage || !api) return false
  return api.selectPassage(passage)
}

const words = (s: string, n: number, fromEnd: boolean) => {
  const w = s.trim().split(/\s+/)
  return (fromEnd ? w.slice(-n) : w.slice(0, n)).join(" ")
}

useLibraryStore.subscribe((state, prev) => {
  if (!pending || state.highlights === prev.highlights) return
  const fresh = Object.values(state.highlights).find((h) => h.paperId === pending!.paperId && !prev.highlights[h.id])
  if (!fresh) return
  const { paperId, topicId, lineId } = pending
  pending = null
  // Highlighting the passage Owlit suggested keeps that passage's section name
  const k = useKnowledgeStore.getState().paper(paperId)
  const likely = k.passages[k.likely?.[`${topicId}/${lineId}`] ?? ""]
  const same = likely && fresh.text.toLowerCase().includes(words(likely.start, 3, true).toLowerCase())
  const passageId = `hl-${fresh.id}`
  addPassage(paperId, { id: passageId, section: same ? likely.section : `p. ${fresh.page + 1}`, text: fresh.text, start: words(fresh.text, 5, false), end: words(fresh.text, 5, true), page: fresh.page })
  useKnowledgeStore.getState().patchPaper(paperId, (p) => ({ found: { ...p.found, [`${topicId}/${lineId}`]: { topicId, passageId } } }))
})
