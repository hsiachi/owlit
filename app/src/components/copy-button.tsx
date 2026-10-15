import { t } from "@lingui/core/macro"
import { CheckIcon, CopyIcon } from "lucide-react"
import { IconButton } from "@/components/icon-button"
import { useCopyFlash } from "@/hooks/use-copy-flash"
import { copyText } from "@/lib/clipboard"

// Copies text; its icon turns to a check for a moment once the text is on the clipboard
export function CopyButton({ text, label = t({ message: "Copy", comment: "verb" }), size = "icon-xs", className }: { text: string; label?: string; size?: "icon-xs" | "icon-sm"; className?: string }) {
  const [copied, flash] = useCopyFlash()
  return (
    <IconButton
      label={copied ? t`Copied` : label}
      size={size}
      className={className}
      onClick={() => {
        void copyText(text).then((ok) => ok && flash())
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  )
}
