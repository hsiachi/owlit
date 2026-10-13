import { useEffect, useRef, useState } from "react"
import { CheckIcon, CopyIcon, MessageSquareTextIcon, Trash2Icon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { OwlitMark } from "@/components/owlit-mark"
import { Tip } from "@/components/tip"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { useWindowKeydown } from "@/hooks/use-window-keydown"
import { HIGHLIGHT_COLORS, HIGHLIGHT_LABEL, HIGHLIGHT_VAR } from "../lib/highlights"
import type { HighlightColor } from "../types"

// The one popover for text in the PDF, whether it is a fresh selection or an existing highlight:
// four colours, copy, comment, Ask Owlit, and for a highlight, delete. The same look for both, so a
// highlight is just a selection that was kept.

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

  const copy = async () => {
    if (!(await onCopy())) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  // 1–4 pick a colour, ⌘C copies, Esc closes; not while typing a comment
  useWindowKeydown((e) => {
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
  })

  return (
    // The menu material, at a menu's 14px corners. Presses and clicks stop here: the toolbar floats over the
    // page's text and links, and none of them may get a press meant for the toolbar (the page's own
    // pointer handlers, a citation hotspot that would jump the PDF)
    <div
      data-reader-ui
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn("menu-surface rounded-xl p-1.5 text-popover-foreground", commenting && "w-72")}
    >
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
        <Separator orientation="vertical" className="mx-1 h-4" />
        <IconButton label={copied ? "Copied" : "Copy"} shortcut={copied ? undefined : "copy"} onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </IconButton>
        <IconButton label={comment ? "Edit comment" : "Comment"} aria-pressed={commenting} onClick={onComment} className={cn(commenting && "bg-accent text-foreground")}>
          <MessageSquareTextIcon />
        </IconButton>
        {onAsk && (
          // Owlit's own mark, as on every control whose action is Owlit; named "Ask Owlit" as everywhere else
          <IconButton label="Ask Owlit" onClick={onAsk}>
            <OwlitMark />
          </IconButton>
        )}
        {onDelete && (
          <IconButton label="Delete highlight" onClick={onDelete}>
            <Trash2Icon />
          </IconButton>
        )}
      </div>
      {commenting && <CommentField comment={comment} onChange={(text) => onCommentChange?.(text)} onDone={onClose} />}
    </div>
  )
}

// The comment on a highlight. Each keystroke is kept as it is typed, so a press outside (which closes the
// popover) loses nothing. Enter saves and closes, Shift+Enter starts a new line: in a blind test a comment
// ended with Enter was lost, and Enter is what people press to finish a short line. Esc closes it through
// the toolbar's own keys, keeping what was typed, as before.
function CommentField({ comment, onChange, onDone }: { comment?: string; onChange: (text: string) => void; onDone: () => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  // The words as typed: the highlight keeps none while they are only spaces, and the field shouldn't lose them
  const [draft, setDraft] = useState(comment ?? "")

  useEffect(() => {
    const el = field.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  return (
    <textarea
      ref={field}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(e.target.value)
      }}
      onKeyDown={(e) => {
        // Enter while an input method is composing picks its word; it doesn't end the comment
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
        e.preventDefault()
        onChange(draft.trim())
        onDone()
      }}
      onBlur={() => onChange(draft.trim())}
      rows={3}
      placeholder="Add a comment"
      className="mt-1.5 block max-h-48 min-h-16 w-full resize-none rounded-md border bg-card px-2.5 py-2 text-sm leading-normal outline-none [field-sizing:content] placeholder:text-muted-foreground focus:border-foreground/30"
    />
  )
}
