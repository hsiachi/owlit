import { useState } from "react"

// The left edge of a right-hand panel (the agent panel, a paper's details): drag it, or use the arrow keys,
// to resize; double-click goes back to the default. Nothing shows until it is hovered, then a 2px line, like
// the list panel's edge. It sits at the left of its parent, which must be the panel itself (or a box as wide
// as it) and positioned. `max` may depend on the room around the panel, so it is asked at each change.
export function PanelResizeHandle({
  width,
  setWidth,
  min = 0,
  max,
  defaultWidth,
  label,
}: {
  width: number
  setWidth: (width: number) => void
  // Leave both out when setWidth keeps the width in range itself
  min?: number
  max?: (panel: HTMLElement) => number
  defaultWidth: number
  label: string
}) {
  const [dragging, setDragging] = useState(false)
  const clamp = (panel: HTMLElement, w: number) => Math.round(Math.max(min, Math.min(max ? max(panel) : Infinity, w)))

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const edge = e.currentTarget
    const panel = edge.parentElement!
    const startX = e.clientX
    // Starts from the width on screen, which a narrow window may have cut below the stored one
    const startWidth = panel.getBoundingClientRect().width
    edge.setPointerCapture(e.pointerId)
    setDragging(true)
    // The resize cursor and no text selection over the whole window while dragging, not just the edge
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    const move = (ev: PointerEvent) => setWidth(clamp(panel, startWidth + startX - ev.clientX))
    const end = () => {
      edge.removeEventListener("pointermove", move)
      edge.removeEventListener("pointerup", end)
      edge.removeEventListener("pointercancel", end)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setDragging(false)
    }
    edge.addEventListener("pointermove", move)
    edge.addEventListener("pointerup", end)
    edge.addEventListener("pointercancel", end)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(defaultWidth)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault()
          setWidth(clamp(e.currentTarget.parentElement!, width + (e.key === "ArrowLeft" ? 16 : -16)))
        }
      }}
      className="absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize outline-hidden after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 hover:after:bg-sidebar-border focus-visible:after:bg-ring data-dragging:after:bg-sidebar-border"
    />
  )
}
