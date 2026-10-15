import { t } from "@lingui/core/macro"
import type { WorkspaceFile } from "@owlit/protocol"
import { UsersIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { isDesktop } from "@/lib/rpc"
import { ShareDialog } from "./ShareDialog"
import { useShareStore } from "./store"

// The doc header's part in sharing: Share, or Shared once the doc has a link. Readers' comments are with
// the doc's other comments, in its column (comments/).
export function DocShareControls({ file }: { file: WorkspaceFile }) {
  const [open, setOpen] = useState(false)
  const shared = useShareStore((s) => !!s.byPath[file.path])
  const problem = useShareStore((s) => !!s.byPath[file.path]?.problem)
  if (!isDesktop) return null

  return (
    <>
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
