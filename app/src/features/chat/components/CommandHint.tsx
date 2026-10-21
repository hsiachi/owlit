import { Trans } from "@lingui/react/macro"
import { cn } from "@/lib/utils"

// Where an empty chat says what "/" offers, in the Chat page and the panel alike: the commands are found by
// typing, so the empty state names them once
export function CommandHint({ className }: { className?: string }) {
  return (
    <p className={cn("text-detail text-muted-foreground", className)}>
      <Trans comment="under an empty chat's composer; the /names stay as they are">
        Type <kbd className="font-mono">/</kbd> to <span className="font-mono">/review</span> a doc as a reader, <span className="font-mono">/revise</span> it by its comments, or <span className="font-mono">/go-through</span> a meeting.
      </Trans>
    </p>
  )
}
