import { t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import type { Change } from "@owlit/protocol"
import { RowList, revealOnHover, rowClass } from "@/components/row-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useChatStore } from "@/features/chat/store"
import { nameOf } from "@/lib/actors"
import { clock, dateTime } from "@/lib/time"
import { rpc } from "@/lib/rpc"
import { toastLeft, undoChange } from "@/lib/changes"
import { displayName, type WorkspaceFile } from "../types"
import { toastError, toastUndo } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { capital } from "@/lib/words"

// Every change the log keeps for the doc, newest first, each named by who made it (a typing session is one
// change). Undo takes that change back passage by passage, keeping what was written since; a passage that
// was itself edited since stays, and the toast names it.
export function VersionsDialog({ file, open, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [changes, setChanges] = useState<Change[] | null>(null)
  const chats = useChatStore((s) => s.chats)
  const name = displayName(file.path)

  useEffect(() => {
    if (!open) return
    let live = true
    rpc.changes
      .list({ target: { kind: "doc", path: file.path } })
      .then((all) => live && setChanges(all))
      .catch(() => live && setChanges([]))
    return () => {
      live = false
    }
  }, [open, file.path])

  const restore = (c: Change) =>
    rpc.changes
      .undo({ id: c.id })
      .then(({ change, left }) => {
        onOpenChange(false)
        if (left?.length) toastLeft(name, left)
        toastUndo(t({ message: "Change undone", comment: "a toast: a change from a doc's Versions was taken back" }), () => undoChange(change.id, name), { description: name })
      })
      .catch(toastError)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading
          title={t`Versions of ${name}`}
          about={t`The changes made to this doc and who made them, kept for 30 days. Undo takes back one change and keeps what was written after it; a passage edited since stays as it is.`}
        />
        {changes && !changes.length && <p className="py-6 text-center text-sm text-muted-foreground">{t`No changes to this doc are kept.`}</p>}
        {!!changes?.length && (
          <RowList as="ul" className="max-h-96 overflow-y-auto">
            {changes.map((c) => {
              const chatId = c.origin.chatId
              const when = c.until ? `${dateTime(c.at)}–${clock(c.until)}` : dateTime(c.at)
              const title = chatId ? chats[chatId]?.title : undefined
              const who = nameOf(c.actor)
              return (
                <li key={c.id} className={cn("group/row flex h-11 items-center gap-3 pr-1 hover:bg-accent", rowClass)}>
                  <p className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 text-sm">
                      {capital(said(c, who))}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {title ? t`${when} · from “${title}”` : chatId ? t`${when} · from a chat` : when}
                    </span>
                  </p>
                  <Button variant="ghost" size="sm" className={revealOnHover} onClick={() => restore(c)}>
                    {t({ message: "Undo", comment: "verb: take back this change to the doc" })}
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

// What a change did, by whom; who is you, a name, Owlit or outside owlit
function said(c: Change, who: string) {
  if (c.undoes) return t({ message: `Undone by ${who}`, comment: "a change in a doc's Versions; who is you, a name, Owlit or outside owlit" })
  if (c.action === "create") return t({ message: `Made by ${who}`, comment: "a change in a doc's Versions: the doc was made; who is you, a name, Owlit or outside owlit" })
  if (c.action === "delete") return t({ message: `Deleted by ${who}`, comment: "a change in a doc's Versions: the doc was deleted; who is you, a name, Owlit or outside owlit" })
  return t({ message: `Changed by ${who}`, comment: "a change in a doc's Versions; who is you, a name, Owlit or outside owlit" })
}
