// The desktop app's right-click menu for text is the system's (spelling, Look Up, Cut, Copy, Paste),
// drawn by the app. A place where a selection can be handed to Owlit registers here, so that menu starts
// with "Ask Owlit" whenever the right-click lands in it with a passage selected.

import { bridge } from "@/lib/rpc"

// A selection shorter than this is a stray click-drag, not a passage to ask about
const MIN_PASSAGE = 3
export const isPassage = (text: string) => text.trim().length >= MIN_PASSAGE

// Given at the moment of the right-click: what "Ask Owlit" will do, or null when there is nothing to ask
type AskFor = () => (() => void) | null

const places = new Map<Element, AskFor>()
// The ask the open menu would run
let pending: (() => void) | null = null

// Returns an unregister
export function askOwlitOnRightClick(place: Element, askFor: AskFor) {
  places.set(place, askFor)
  return () => {
    places.delete(place)
  }
}

export function startTextMenu() {
  const shell = bridge
  if (!shell) return
  // In the capture phase, so it is told even when something inside stops the event; a right-click the
  // page answers with its own menu never shows the system's, and the next right-click tells afresh
  window.addEventListener(
    "contextmenu",
    (e) => {
      pending = null
      const target = e.target instanceof Node ? e.target : null
      for (const [place, askFor] of places) {
        if (target && place.contains(target)) {
          pending = askFor()
          break
        }
      }
      shell.textMenuAsk(pending !== null)
    },
    true,
  )
  shell.onTextMenuAsk(() => {
    pending?.()
    pending = null
  })
}
