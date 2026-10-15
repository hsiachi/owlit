import { t } from "@lingui/core/macro"
import { CheckIcon, CopyIcon, MessageSquareTextIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Tip } from "@/components/tip"
import { copyText } from "@/lib/clipboard"

// Copied text says so with a check for this long
const COPIED_FOR = 1500

// The menu's items, inside its `.selection-menu` frame. `selected` reads the passage when Copy is pressed.
export function SelectionMenuItems({ onAsk, selected, onComment }: { onAsk: () => void; selected: () => string; onComment?: () => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const done = setTimeout(() => setCopied(false), COPIED_FOR)
    return () => clearTimeout(done)
  }, [copied])
  // Pressing a button keeps the selection (and the focus) where it is
  const keep = (e: React.MouseEvent) => e.preventDefault()
  const copyLabel = copied ? t`Copied` : t({ message: "Copy", comment: "verb: copy the text" })
  const commentLabel = t({ message: "Comment", context: "verb: say something about the selected words" })
  return (
    <>
      <button type="button" onMouseDown={keep} onClick={onAsk}>
        {t`Ask Owlit`}
      </button>
      <span aria-hidden className="selection-menu-divider" />
      <Tip label={copyLabel} shortcut={copied ? undefined : "copy"}>
        <button type="button" className="selection-menu-icon" aria-label={copyLabel} onMouseDown={keep} onClick={() => void copyText(selected()).then((ok) => ok && setCopied(true))}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </Tip>
      {onComment && (
        <Tip label={commentLabel} shortcut="comment">
          <button type="button" className="selection-menu-icon" aria-label={commentLabel} onMouseDown={keep} onClick={onComment}>
            <MessageSquareTextIcon />
          </button>
        </Tip>
      )}
    </>
  )
}
