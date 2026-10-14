import { t } from "@lingui/core/macro"
import { useNavigate } from "react-router-dom"
import { cn } from "@/lib/utils"

// One look for a mentioned workspace item wherever it appears. In the editor it carries a faint fill so
// it reads as one unit you can delete; in text it is plain coloured words that fill only on hover, and a
// button when it opens something. Inline-flex keeps the text baseline (an overflow-hidden inline-block
// would sit on its bottom edge). A paper nobody but Owlit has read yet is a step lighter (unread).
export function MentionToken({
  label,
  variant = "inline",
  className,
  title,
  unread,
  quote,
  onClick,
}: {
  label: React.ReactNode
  variant?: "field" | "inline"
  className?: string
  title?: string
  unread?: boolean
  // The sentence of the paper a citation rests on, shown under the title on hover
  quote?: string
  onClick?: () => void
}) {
  if (unread) title = title ? `${title} · ${t`Unread`}` : t`Unread`
  if (quote) title = `${title ?? ""}\n“${quote}”`.trim()
  const look = cn(
    "inline-flex max-w-80 items-baseline rounded-[0.3em] px-[0.2em] align-baseline transition-colors",
    unread ? "text-mention-unread" : "text-mention",
    variant === "field" ? "bg-mention/8" : "-mx-[0.2em] hover:bg-mention/10",
    className,
  )
  const text = <span className="min-w-0 truncate">{label}</span>
  if (!onClick)
    return (
      <span title={title} className={look}>
        {text}
      </span>
    )
  return (
    <button type="button" title={title} onClick={onClick} className={cn(look, "cursor-pointer outline-none focus-key:bg-mention/10")}>
      {text}
    </button>
  )
}

// A mention that opens a place in the app
export function MentionLink({ label, to, title, className }: { label: React.ReactNode; to?: string | null; title?: string; className?: string }) {
  const navigate = useNavigate()
  return <MentionToken label={label} title={title} className={className} onClick={to ? () => navigate(to) : undefined} />
}
