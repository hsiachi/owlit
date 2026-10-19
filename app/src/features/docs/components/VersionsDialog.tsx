import { t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import type { Change, PersonId, Roster } from "@owlit/protocol"
import { RowList, revealOnHover, rowClass } from "@/components/row-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useChatStore } from "@/features/chat/store"
import { useSettings } from "@/features/settings/store"
import { actorLabel } from "@/lib/actors"
import { dateTime } from "@/lib/time"
import { rpc } from "@/lib/rpc"
import { undoChange } from "@/lib/changes"
import { displayName, type WorkspaceFile } from "../types"
import { toastError, toastUndo } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { capital } from "@/lib/words"

// Every change the log keeps for the doc, newest first, each named by who made it. Restore puts back the
// text from before that change even if the doc changed since; the toast offers Undo.
export function VersionsDialog({ file, open, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [roster, setRoster] = useState<Roster>({})
  const chats = useChatStore((s) => s.chats)
  const myId = useSettings((s) => s.view?.profile.id)
  const me: PersonId | undefined = myId ? `p_${myId}` : undefined
  const name = displayName(file.path)

  useEffect(() => {
    if (!open) return
    let live = true
    rpc.changes
      .list({ target: { kind: "doc", path: file.path } })
      // A change that created the doc has no text from before; restoring it would only delete the doc
      .then((all) => live && setChanges(all.filter((c) => c.action !== "create")))
      .catch(() => live && setChanges([]))
    rpc.members
      .get()
      .then((members) => live && setRoster(members))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [open, file.path])

  const restore = (c: Change) =>
    rpc.changes
      .undo({ id: c.id, force: true })
      .then(({ change }) => {
        onOpenChange(false)
        toastUndo(t`Version restored`, () => undoChange(change.id, name), { description: name })
      })
      .catch(toastError)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading
          title={t`Versions of ${name}`}
          about={t`The changes made to this doc and who made them, kept for 30 days. Restore puts back the text from before a change, even if the doc changed since.`}
        />
        {changes && !changes.length && <p className="py-6 text-center text-sm text-muted-foreground">{t`No changes to this doc are kept.`}</p>}
        {!!changes?.length && (
          <RowList as="ul" className="max-h-96 overflow-y-auto">
            {changes.map((c) => {
              const chatId = c.origin.chatId
              const when = dateTime(c.at)
              const title = chatId ? chats[chatId]?.title : undefined
              const who = actorLabel(c.actor, me, roster)
              return (
                <li key={c.id} className={cn("group/row flex h-11 items-center gap-3 pr-1 hover:bg-accent", rowClass)}>
                  <p className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 text-sm">
                      {capital(c.undoes ? t({ message: `Undone by ${who}`, comment: "a change in a doc's Versions; who is you, a name, Owlit or outside owlit" }) : t({ message: `Changed by ${who}`, comment: "a change in a doc's Versions; who is you, a name, Owlit or outside owlit" }))}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {title ? t`${when} · from “${title}”` : chatId ? t`${when} · from a chat` : when}
                    </span>
                  </p>
                  <Button variant="ghost" size="sm" className={revealOnHover} onClick={() => restore(c)}>
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
