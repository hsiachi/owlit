import { t } from "@lingui/core/macro"
import { findAnchor, readableText, type WorkspaceFile } from "@owlit/protocol"
import { UsersIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { isDesktop } from "@/lib/rpc"
import { commentCount } from "../editor/reader-comments"
import { useDocsUiStore } from "../ui-store"
import { ShareDialog } from "./ShareDialog"
import { commentThreadsOf, useShareStore } from "./store"

// The doc header's part in sharing: readers' open comments ("2 comments", stepping through them in
// reading order, as the note count does), then Share, or Shared once the doc has a link
export function DocShareControls({ file }: { file: WorkspaceFile }) {
  const [open, setOpen] = useState(false)
  const shared = useShareStore((s) => !!s.byPath[file.path])
  const problem = useShareStore((s) => !!s.byPath[file.path]?.problem)
  const threads = commentThreadsOf(useShareStore((s) => s.comments[file.path]))
  const current = useDocsUiStore((s) => (s.openComment?.docId === file.id ? s.openComment.threadId : null))
  if (!isDesktop) return null

  const next = () => {
    const text = readableText(file.content ?? "").text
    // Passages gone from the doc sort first, as they sit by the title
    const ordered = [...threads].sort((a, b) => (findAnchor(text, a.root.anchor) ?? -1) - (findAnchor(text, b.root.anchor) ?? -1))
    const i = ordered.findIndex((th) => th.root.id === current)
    useDocsUiStore.getState().setOpenComment(file.id, ordered[(i + 1) % ordered.length].root.id)
  }

  return (
    <>
      {threads.length > 0 && (
        <Button variant="ghost" size="sm" onClick={next} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
          {commentCount(threads.length)}
        </Button>
      )}
      {/* Changes that didn't reach readers are broken, so the ladder's red word, not a tooltip alone; the
          dialog says why */}
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
        <UsersIcon />
        {shared ? t`Shared` : t`Share`}
        {problem && <span className="text-destructive">· {t({ message: "Not sent", comment: "your latest changes didn't reach the shared doc's readers" })}</span>}
      </Button>
      <ShareDialog file={file} open={open} onOpenChange={setOpen} />
    </>
  )
}
