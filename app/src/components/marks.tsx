import { ShieldAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// The marks of the ladder of states, one look each everywhere (DESIGN.md, rule 3)

// The 8px `note` dot: something Owlit added or changed since the user last looked. Without a label it is
// decoration beside words that already say so.
export function NoteDot({ className, label = "Changed since you last looked" }: { className?: string; label?: string | false }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      title={label || undefined}
      className={cn("note-dot inline-block size-2 shrink-0 rounded-full", className)}
    />
  )
}

// Waiting on you: a shape, so it never passes for the note dot. 14px beside small text, 16px beside 14px text.
export function WaitingShield({ size = "sm", className }: { size?: "sm" | "md"; className?: string }) {
  return <ShieldAlertIcon aria-hidden className={cn("shrink-0 text-warning", size === "sm" ? "size-3.5" : "size-4", className)} />
}

// The shield and its words, laid out by the line they sit in
export function WaitingLabel({ size, children = "Waiting on you" }: { size?: "sm" | "md"; children?: React.ReactNode }) {
  return (
    <>
      <WaitingShield size={size} />
      <span className="truncate">{children}</span>
    </>
  )
}

// The "·" between two details in a line, in the line's own colour
export function Dot() {
  return (
    <span aria-hidden className="px-1">
      ·
    </span>
  )
}
