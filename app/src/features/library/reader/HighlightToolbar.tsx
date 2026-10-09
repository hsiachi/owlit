import { useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, MessageSquareTextIcon, Trash2Icon } from "lucide-react"
import { OwlitMark } from "@/components/owlit-mark"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HIGHLIGHT_COLORS, HIGHLIGHT_LABEL, HIGHLIGHT_VAR } from "../lib/highlights"
import type { HighlightColor } from "../types"

// The one popover for text in the PDF, whether it is a fresh selection or an existing highlight:
// four colours, copy, comment, Ask Owlit, and for a highlight, delete. The same look for both, so a
// highlight is just a selection that was kept.

const BUTTON = "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4"

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function HighlightToolbar({
  color,
  onColor,
  onCopy,
  onComment,
  onDelete,
  onAsk,
  comment,
  commenting,
  onCommentChange,
  onClose,
}: {
  // The highlight's colour; none for a fresh selection
  color?: HighlightColor
  onColor: (c: HighlightColor) => void
  // Resolves true once the text is on the clipboard
  onCopy: () => Promise<boolean>
  onComment: () => void
  onDelete?: () => void
  // Sends the passage, with its page, to the agent window: reading is when people ask most
  onAsk?: () => void
  comment?: string
  commenting?: boolean
  onCommentChange?: (text: string) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)

  const copy = async () => {
    if (!(await onCopy())) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  // 1–4 pick a colour, ⌘C copies, Esc closes; not while typing a comment
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable=true]")
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
        return
      }
      if (typing) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        e.preventDefault()
        void copy()
        return
      }
      const n = Number(e.key)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && n >= 1 && n <= HIGHLIGHT_COLORS.length) {
        e.preventDefault()
        onColor(HIGHLIGHT_COLORS[n - 1])
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  useEffect(() => {
    if (!commenting) return
    const el = field.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [commenting])

  return (
    // The menu material: popover surface, hairline ring, soft shadow, 14px corners
    <div data-reader-ui className={cn("rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/8 dark:ring-foreground/14", commenting && "w-72")}>
      <div className="flex items-center gap-0.5">
        <div className="flex items-center gap-1 px-1">
          {HIGHLIGHT_COLORS.map((c) => (
            <Tip key={c} label={HIGHLIGHT_LABEL[c]}>
              <button
                type="button"
                aria-label={HIGHLIGHT_LABEL[c]}
                aria-pressed={color === c}
                onClick={() => onColor(c)}
                className="flex size-6 items-center justify-center rounded-full"
              >
                {/* The current colour carries a check, as a menu's selected item does. The page under a
                    highlight is white in both themes, so the dot and its check are too. */}
                <span
                  style={{ background: HIGHLIGHT_VAR[c] }}
                  className="grid size-4.5 place-items-center rounded-full ring-1 ring-(--pdf-page-edge) ring-inset transition-transform hover:scale-110"
                >
                  {color === c && <CheckIcon className="size-3 text-(--pdf-ink)" strokeWidth={3} />}
                </span>
              </button>
            </Tip>
          ))}
        </div>
        <span className="mx-1 h-4 w-px bg-border" />
        <Tip label={copied ? "Copied" : "Copy"}>
          <button type="button" aria-label="Copy" onClick={copy} className={BUTTON}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </Tip>
        <Tip label={comment ? "Edit comment" : "Comment"}>
          <button type="button" aria-label="Comment" aria-pressed={commenting} onClick={onComment} className={cn(BUTTON, commenting && "bg-accent text-foreground")}>
            <MessageSquareTextIcon />
          </button>
        </Tip>
        {onAsk && (
          <Tip label="Ask Owlit">
            <button type="button" aria-label="Ask Owlit" onClick={onAsk} className={BUTTON}>
              <OwlitMark />
            </button>
          </Tip>
        )}
        {onDelete && (
          <Tip label="Delete highlight">
            <button type="button" aria-label="Delete highlight" onClick={onDelete} className={BUTTON}>
              <Trash2Icon />
            </button>
          </Tip>
        )}
      </div>
      {commenting && (
        <textarea
          ref={field}
          value={comment ?? ""}
          onChange={(e) => onCommentChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              onClose()
            }
          }}
          rows={3}
          placeholder="Add a comment"
          className="mt-1.5 block max-h-48 min-h-16 w-full resize-none rounded-md border bg-card px-2.5 py-2 text-sm leading-normal outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-foreground/30"
        />
      )}
    </div>
  )
}
