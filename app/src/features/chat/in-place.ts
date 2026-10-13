import { create } from "zustand"
import { countDown, countUp } from "@/lib/counts"

// Owlit's proposed edits an editor on screen has drawn in place (an open doc, a paper's note), by their
// permission request. While one is, it is answered there, with Apply and Discard, and the chat's card
// shrinks to a line pointing at it, so the user isn't shown two sets of buttons for one decision. An edit
// the editor couldn't place (its passage isn't in the doc as it reads now, or it would replace most of
// it) isn't drawn, and the card keeps its buttons.
export const useInPlace = create<{ drawn: Record<string, number> }>(() => ({ drawn: {} }))

// One editor's share: call it with the requests it draws now, every time that changes, and with [] once
// it closes
export function drawnEdits() {
  let mine: string[] = []
  return (requestIds: string[]) => {
    if (requestIds.length === mine.length && requestIds.every((id, i) => id === mine[i])) return
    const before = mine
    mine = requestIds
    useInPlace.setState((s) => {
      let drawn = s.drawn
      for (const id of before) drawn = countDown(drawn, id)
      for (const id of requestIds) drawn = countUp(drawn, id)
      return { drawn }
    })
  }
}
