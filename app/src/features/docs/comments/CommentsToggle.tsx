import { t } from "@lingui/core/macro"
import { MessageSquareTextIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tip } from "@/components/tip"
import { cn } from "@/lib/utils"
import { useDocsUiStore } from "../ui-store"
import { useCommentViews } from "./hooks"

// The doc header's comment button, shown while the doc has comments: how many, and whether the column
// beside the doc is shown. Hidden, the words keep their underline, and a click on one shows it again.
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
        aria-label={shown ? t`Hide comments` : t`Show comments`}
        onClick={() => useDocsUiStore.getState().setCommentsShown(!shown)}
        className={cn("h-7 px-2 font-normal text-muted-foreground hover:text-foreground", shown && "text-foreground")}
      >
        <MessageSquareTextIcon />
        {count}
      </Button>
    </Tip>
  )
}
