import { useEffect, useRef } from "react"
import { MessageSquareTextIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import type { AgentNote } from "../types"

export interface Placed {
  note: AgentNote
  top: number
  lost: boolean
}

export interface Actions {
  onChat: (note: AgentNote) => void
  onDismiss: (note: AgentNote) => void
}

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })

export function NotesLayer({ placed, open, onToggle, onClose, onChat, onDismiss }: { placed: Placed[]; open: string | null; onToggle: (id: string) => void; onClose: () => void } & Actions) {
  const ref = useRef<HTMLDivElement>(null)
  // A click elsewhere or Esc puts the card away
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open, onClose])

  return (
    <div ref={ref}>
      {placed.map(({ note, top, lost }) => (
        <div key={note.id} className="absolute right-0" style={{ top }}>
          <button
            type="button"
            aria-label={`Note from ${note.by}`}
            aria-expanded={open === note.id}
            onClick={() => onToggle(note.id)}
            className={cn(
              "flex size-[22px] items-center justify-center rounded-[7px] text-muted-foreground outline-hidden transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent",
              open === note.id && "bg-accent text-foreground",
            )}
          >
            <MessageSquareTextIcon className="size-3.5" />
          </button>
          {open === note.id && (
            <div className="absolute top-7 right-0 z-30 w-72 rounded-xl border bg-popover p-3.5 pb-2.5 text-sm leading-normal text-popover-foreground shadow-lg">
              <p className="mb-1 text-xs text-muted-foreground">
                {note.by} · {day(note.createdAt)}
              </p>
              {lost && (
                <p className="mb-1.5 text-[13px] text-muted-foreground">
                  The passage this note was on has changed: “{note.quote.length > 80 ? `${note.quote.slice(0, 80)}…` : note.quote}”
                </p>
              )}
              <p>{note.text}</p>
              <div className="mt-2.5 -mr-1.5 flex justify-end gap-1">
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onDismiss(note)}>
                  Dismiss
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onChat(note)}>
                  Chat about this
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
