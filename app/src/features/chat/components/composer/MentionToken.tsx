import { cn } from "cn"

// One look for a mentioned workspace item wherever it appears. In the editor it
// carries a faint fill so it reads as one unit you can delete; in messages it is
// plain coloured text that only fills on hover. Inline-flex keeps the text
// baseline (an overflow-hidden inline-block would sit on its bottom edge).
export function MentionToken({
  label,
  variant = "inline",
  className,
  title,
  onClick,
}: {
  label: string
  variant?: "field" | "inline"
  className?: string
  title?: string
  onClick?: () => void
}) {
  return (
    <span
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex max-w-80 items-baseline rounded-[0.3em] px-[0.2em] align-baseline text-mention transition-colors",
        variant === "field" ? "bg-mention/8" : "-mx-[0.2em] cursor-pointer hover:bg-mention/10",
        className,
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}
