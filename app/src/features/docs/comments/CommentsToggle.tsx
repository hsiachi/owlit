import { plural, t } from "@lingui/core/macro"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/tip"
import { cn } from "@/lib/utils"
import { useDocsUiStore } from "../ui-store"
import { useCommentViews } from "./hooks"

// The doc header's comment button, shown while the doc has comments: how many, in words as the header's
// other buttons say what is there, and whether the column beside the doc is shown (ink while it is, muted
// while hidden). Hidden, the words keep their underline, and a click on one shows it again.
export function CommentsToggle({ docId }: { docId: string }) {
  const count = useCommentViews(docId).length
  const shown = useDocsUiStore((s) => s.commentsShown)
  if (!count) return null
  return (
    <Tip label={shown ? t`Hide comments` : t`Show comments`}>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={shown}
        onClick={() => useDocsUiStore.getState().setCommentsShown(!shown)}
        className={cn("h-7 px-2 font-normal text-muted-foreground hover:text-foreground", shown && "text-foreground")}
      >
        {plural(count, { one: "# comment", other: "# comments" })}
      </Button>
    </Tip>
  )
}
