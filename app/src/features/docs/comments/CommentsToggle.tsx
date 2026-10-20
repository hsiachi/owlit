import { plural, t } from "@lingui/core/macro"
import type { WorkspaceFile } from "@owlit/protocol"
import { useEffect } from "react"
import { markSeen } from "@/app/seen"
import { NoteDot } from "@/components/marks"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/tip"
import { cn } from "@/lib/utils"
import { useDocsUiStore } from "../ui-store"
import { useNewOwlitComments } from "../owlit"
import { useCommentViews } from "./hooks"
import { docKey } from "./model"

// New comments count as seen once they have been on screen this long
const SEEN_AFTER_MS = 3000

// The doc header's comment button, shown while the doc has comments: how many, in words as the header's
// other buttons say what is there, and whether the column beside the doc is shown (ink while it is, muted
// while hidden). Hidden, the words keep their underline, and a click on one shows it again. Owlit's dot
// while it left comments the user hasn't seen: a click then opens the first of them.
export function CommentsToggle({ file }: { file: WorkspaceFile }) {
  const count = useCommentViews(file.id).length
  const shown = useDocsUiStore((s) => s.commentsShown)
  const fresh = useNewOwlitComments(file)

  // Comments on screen a moment are seen: the dot goes
  const freshCount = fresh.length
  useEffect(() => {
    if (!freshCount || !shown) return
    const timer = setTimeout(() => markSeen({ kind: "comments", path: file.path }), SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [freshCount, shown, file.path])

  if (!count) return null
  const first = fresh[0]
  return (
    <Tip label={first ? t`Owlit commented since you last looked` : shown ? t`Hide comments` : t`Show comments`}>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={shown}
        onClick={() => {
          if (first) useDocsUiStore.getState().setOpenComment(file.id, docKey(first.id))
          else useDocsUiStore.getState().setCommentsShown(!shown)
        }}
        className={cn("h-7 px-2 font-normal text-muted-foreground hover:text-foreground", shown && "text-foreground")}
      >
        <span className="relative">
          {plural(count, { one: "# comment", other: "# comments" })}
          {first && <NoteDot label={false} className="absolute -top-0.5 -right-1.5 size-1.5" />}
        </span>
      </Button>
    </Tip>
  )
}
