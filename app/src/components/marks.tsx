import { cn } from "@/lib/utils"

// The marks of the ladder of states, one look each everywhere (DESIGN.md, rule 3)

// Owlit's 8px dot, a plain `owlit-mark` fill: something Owlit added or changed since the user last looked.
// Without a label it is decoration beside words that already say so. `gone` keeps its place while it leaves: it fades and shrinks
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
        "inline-block size-2 shrink-0 rounded-full bg-owlit-mark transition-[opacity,scale] duration-400 ease-(--ease) motion-reduce:transition-opacity",
        gone && "scale-[0.6] opacity-0",
        className,
      )}
    />
  )
}

// Waiting on you, in words. The words carry it alone: a mark beside them would say it twice, and the
// `warning` dot is kept for the places with no room for words (the status slot, the rail).
export function WaitingLabel({ children = "Waiting on you" }: { children?: React.ReactNode }) {
  return <span className="truncate">{children}</span>
}

// The "·" between two details in a line, in the line's own colour
export function Dot() {
  return (
    <span aria-hidden className="px-1">
      ·
    </span>
  )
}
