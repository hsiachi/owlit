import { t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import type { VersionInfo } from "@owlit/protocol"
import { toast } from "sonner"
import { RowList, rowClass } from "@/components/row-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useChatStore } from "@/features/chat/store"
import { dateTime } from "@/lib/time"
import { rpc } from "@/lib/rpc"
import { undoChange } from "@/lib/versions"
import { displayName, type WorkspaceFile } from "../types"
import { toastUndo } from "@/lib/toast"
import { cn } from "@/lib/utils"

// The doc as it was before each change an agent made to it (and before each undo), newest first. Restore
// puts that text back even if the doc changed since; the toast offers Undo.
export function VersionsDialog({ file, open, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const chats = useChatStore((s) => s.chats)
  const name = displayName(file.path)

  useEffect(() => {
    if (!open) return
    let live = true
    rpc.versions
      .list({ path: file.path })
      // A version from before the doc existed would only delete it
      .then((all) => live && setVersions(all.filter((v) => v.kind === "file" && v.existed !== false)))
      .catch(() => live && setVersions([]))
    return () => {
      live = false
    }
  }, [open, file.path])

  const restore = (v: VersionInfo) =>
    rpc.versions
      .restore({ id: v.id, force: true })
      .then(({ redoId }) => {
        onOpenChange(false)
        toastUndo(t`Version restored`, () => undoChange(redoId, name), { description: name })
      })
      .catch((error: Error) => toast.error(error.message))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading
          title={t`Versions of ${name}`}
          about={t`The text from before each change Owlit made to this doc, kept for 30 days. Restore puts it back even if the doc changed since.`}
        />
        {versions && !versions.length && <p className="py-6 text-center text-sm text-muted-foreground">{t`Owlit hasn't changed this doc.`}</p>}
        {!!versions?.length && (
          <RowList as="ul" className="max-h-96 overflow-y-auto">
            {versions.map((v) => {
              const chat = v.chatId ? chats[v.chatId] : undefined
              const when = dateTime(v.at)
              const title = chat?.title
              return (
                <li key={v.id} className={cn("group/version flex h-11 items-center gap-3 pr-1 hover:bg-accent", rowClass)}>
                  <p className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 text-sm">{v.by === "undo" ? t`Before an undo` : t`Before Owlit's edit`}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {title ? t`${when} · from “${title}”` : v.chatId ? t`${when} · from a chat` : when}
                    </span>
                  </p>
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover/version:opacity-100 focus-visible:opacity-100" onClick={() => restore(v)}>
                    {t({ message: "Restore", comment: "verb: put this version of the doc back" })}
                  </Button>
                </li>
              )
            })}
          </RowList>
        )}
      </DialogContent>
    </Dialog>
  )
}
