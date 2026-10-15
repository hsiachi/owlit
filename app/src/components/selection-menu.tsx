import { t } from "@lingui/core/macro"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"

// The Docs selection menu: one action, "Ask Owlit", above a selected passage (under it where above would
// leave the view), and not while the mouse is still choosing. Used by a paper's note and its digest.

// Clear of the selected line, as the Docs selection menu sits
const MENU_GAP = 8
// The menu's one 24px row in its 2px frame and hairline border
const MENU_HEIGHT = 30

export type MenuPlace = { left: number; top: number; below: boolean }

// The menu to render in its positioned box, whose button runs `onAsk`, and the calls that place it
export function useSelectionMenu(onAsk: () => void) {
  const [menu, setMenu] = useState<MenuPlace | null>(null)
  const control = useMemo(
    () => ({
      hide: () => setMenu(null),
      // Above the passage's first line when the menu stays under `ceiling` (the top of what it may cover),
      // else under its last line. Places are inside `outer`, the menu's positioned box.
      show: (outer: DOMRect, start: { left: number; top: number }, endBottom: () => number, ceiling: number) => {
        const left = start.left - outer.left
        if (start.top - MENU_GAP - MENU_HEIGHT >= ceiling) setMenu({ left, top: start.top - outer.top - MENU_GAP, below: false })
        else setMenu({ left, top: endBottom() - outer.top + MENU_GAP, below: true })
      },
      // A press in `el` hides the menu while the mouse is still choosing; `place` runs once the release has
      // settled the selection. `primary` leaves other buttons' presses alone. Returns the choosing flag and
      // the call that stops watching.
      watch: (el: HTMLElement, place: () => void, { primary = false } = {}) => {
        let choosing = false
        const down = (e: MouseEvent) => {
          if (primary && e.button !== 0) return
          choosing = true
          setMenu(null)
          document.addEventListener(
            "mouseup",
            () => {
              choosing = false
              // After the release has settled the selection
              setTimeout(place)
            },
            { once: true },
          )
        }
        el.addEventListener("mousedown", down)
        return { choosing: () => choosing, stop: () => el.removeEventListener("mousedown", down) }
      },
    }),
    [],
  )
  // Pressing the button keeps the selection (and the focus) where it is
  const element = menu && (
    <div className={cn("selection-menu absolute z-20", !menu.below && "-translate-y-full")} style={{ left: menu.left, top: menu.top }}>
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onAsk}>
        {t`Ask Owlit`}
      </button>
    </div>
  )
  return { menu: element, control }
}
