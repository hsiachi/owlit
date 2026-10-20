import { t } from "@lingui/core/macro"
import { cn } from "@/lib/utils"

// The marks of the ladder of states, one look each everywhere (DESIGN.md, rule 3)

// Owlit's 8px dot, a plain `owlit-mark` fill: something Owlit added or changed since the user last looked.
// Without a label it is decoration beside words that already say so.
export function NoteDot({
  className,
  label = t`Changed since you last looked`,
  ...props
}: { className?: string; label?: string | false } & Omit<React.ComponentProps<"span">, "className">) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      title={label || undefined}
      {...props}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full bg-owlit-mark",
        className,
      )}
    />
  )
}

// Waiting on you, in words. The words carry it alone: a mark beside them would say it twice, and the
// `warning` dot is kept for the places with no room for words (the status slot, the rail).
export function WaitingLabel({ children = t`Waiting on you` }: { children?: React.ReactNode }) {
  return <span className="truncate">{children}</span>
}

// An 8px mark that names itself when given a label (an image with a tooltip), and is decoration beside
// words that already say it when not
type MarkProps = { className?: string; label?: string } & Omit<React.ComponentProps<"span">, "className">
function Mark({ label, className, base, ...props }: MarkProps & { base: string }) {
  return <span role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} title={label} {...props} className={cn("inline-block size-2 shrink-0 rounded-full", base, className)} />
}

// The `warning` dot: waiting on the user, where there is no room for the words (the status slot, the rail)
export const WaitingDot = (props: MarkProps) => <Mark base="bg-warning" {...props} />

// The red dot: Owlit's run stopped or broke
export const StoppedDot = (props: MarkProps) => <Mark base="bg-destructive" {...props} />

// A half-filled ring: a paper the user has read some of
export const ReadingRing = (props: MarkProps) => (
  <Mark base="border-[1.5px] border-muted-foreground bg-[linear-gradient(90deg,var(--muted-foreground)_50%,transparent_50%)]" {...props} />
)
