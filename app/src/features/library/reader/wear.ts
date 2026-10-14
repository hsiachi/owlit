import type { CitedPassage, CollectedPassage } from "@owlit/protocol"
import { useEffect } from "react"
import { create } from "zustand"
import { isDesktop, rpc } from "@/lib/rpc"
import type { Rect } from "../types"
import { quoteTarget, type PassageTarget } from "./passages"

// Read wear (Hill et al. 1992): what has been read of the open paper, shown on it. The sentences Owlit's
// answers rested on, in chats and in collections, get a thin mark in the margin; the pages the person stayed on darken a strip at the
// reader's edge. Both are for looking, not doing: no counts, no list. Core gathers them when the paper
// opens (library.wear); a sentence that isn't found in the PDF draws nothing.

// What rests on a sentence: an answer in a chat, or a collection's answer for this paper
export type WearSource = ({ kind: "chat" } & CitedPassage) | ({ kind: "collection" } & CollectedPassage)

// One sentence Owlit cited, found on the page; several answers citing the same sentence share it, oldest first
export interface CitedMark {
  key: string
  page: number
  rects: Rect[]
  target: PassageTarget
  cited: WearSource[]
}

interface WearState {
  paperId: string | null
  marks: CitedMark[]
  // Seconds at the top of the screen, by 1-based page
  pages: Record<number, number>
}

export const useWearStore = create<WearState>(() => ({ paperId: null, marks: [], pages: {} }))

type Locate = (p: PassageTarget) => Promise<{ page: number; from: number; rects: Rect[] } | null>

// Loads the paper's wear once its PDF is open, and clears it when the paper closes
export function useReadWear(paperId: string, locate: Locate | null) {
  useEffect(() => {
    if (!isDesktop || !locate) return
    let live = true
    useWearStore.setState({ paperId, marks: [], pages: {} })
    void rpc.library
      .wear({ id: paperId })
      .then(async ({ cited, collected, pages }) => {
        if (!live) return
        useWearStore.setState({ pages })
        const byPlace = new Map<string, CitedMark>()
        const sources: WearSource[] = [...cited.map((c) => ({ kind: "chat" as const, ...c })), ...(collected ?? []).map((c) => ({ kind: "collection" as const, ...c }))].sort((a, b) => a.at - b.at)
        for (const c of sources) {
          const target = quoteTarget(c.quote, c.page)
          const at = await locate(target)
          if (!live) return
          if (!at?.rects.length) continue
          const key = `${at.page}:${at.from}`
          const mark = byPlace.get(key)
          if (mark) mark.cited.push(c)
          else byPlace.set(key, { key, page: at.page, rects: at.rects, target, cited: [c] })
        }
        useWearStore.setState({ marks: [...byPlace.values()] })
      })
      .catch((error) => console.warn("[owlit] read wear not loaded", error))
    return () => {
      live = false
      useWearStore.setState({ paperId: null, marks: [], pages: {} })
    }
  }, [paperId, locate])
}
