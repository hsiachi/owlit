import { useEffect } from "react"
import { create } from "zustand"
import { countDown, countUp } from "@/lib/counts"

// Files whose editor is on screen and draws Owlit's proposed edits in place (an open doc, a paper's note).
// While one is, a permission for an edit to it is answered there, with Apply and Discard, and the chat's
// card shrinks to a line pointing at it, so the user isn't shown two sets of buttons for one decision.
export const useInPlace = create<{ shown: Record<string, number> }>(() => ({ shown: {} }))

export function useShowsEditsInPlace(path: string | undefined) {
  useEffect(() => {
    if (!path) return
    useInPlace.setState((s) => ({ shown: countUp(s.shown, path) }))
    return () => useInPlace.setState((s) => ({ shown: countDown(s.shown, path) }))
  }, [path])
}
