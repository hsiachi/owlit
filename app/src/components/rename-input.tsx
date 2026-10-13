import { t } from "@lingui/core/macro"
import { useRef, useState } from "react"
import { cn } from "@/lib/utils"

// Renaming in place: an input on `card` with the row's own height and corners (from className), the text
// where the name was. Enter or leaving keeps the name; Esc puts it back (`name` null). `byKey`: it ended
// with Enter or Esc, so focus may go back to the row; a blur means the user went elsewhere.
export function RenameInput({
  initial,
  onDone,
  label = t({ message: "Rename", comment: "verb" }),
  className,
  style,
}: {
  initial: string
  onDone: (name: string | null, byKey: boolean) => void
  label?: string
  className?: string
  style?: React.CSSProperties
}) {
  const [draft, setDraft] = useState(initial)
  // Enter or Esc ends it; the blur that follows as the input goes away must not end it again
  const done = useRef(false)
  const finish = (name: string | null, byKey: boolean) => {
    if (done.current) return
    done.current = true
    onDone(name, byKey)
  }
  return (
    <input
      autoFocus
      value={draft}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      // The field keeps the system's text menu (Cut, Copy, Paste) rather than the row's actions
      onContextMenu={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft, false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(draft, true)
        if (e.key === "Escape") finish(null, true)
      }}
      style={style}
      className={cn("w-full min-w-0 rounded-md border bg-card text-sm outline-none focus-visible:border-foreground/30", className)}
    />
  )
}
