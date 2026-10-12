import { ShieldAlertIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// The marks of the ladder of states, one look each everywhere (DESIGN.md, rule 3)

// The 8px `note` dot: something Owlit added or changed since the user last looked. Without a label it is
// decoration beside words that already say so. `gone` keeps its place while it leaves: it fades and shrinks
// over 400ms, slower than any other mark, so the user catches it going and knows what was new.
export function NoteDot({
  className,
  label = "Changed since you last looked",
  gone,
  ...props
}: { className?: string; label?: string | false; gone?: boolean } & Omit<React.ComponentProps<"span">, "className">) {
  const said = gone ? false : label
  return (
    <span
      role={said ? "img" : undefined}
      aria-label={said || undefined}
      aria-hidden={said ? undefined : true}
      title={said || undefined}
      {...props}
      className={cn(
        "note-dot inline-block size-2 shrink-0 rounded-full transition-[opacity,transform] duration-400 ease-(--ease) motion-reduce:transition-opacity",
        gone && "scale-[0.6] opacity-0",
        className,
      )}
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
