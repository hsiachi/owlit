import { plural, t } from "@lingui/core/macro"
import { useEffect, useState } from "react"
import type { Change, EditStats, ProposalHunk } from "@owlit/protocol"
import { FoldChevron } from "@/components/fold"
import { PassageChange } from "@/components/passage-change"
import { RowList, revealOnHover, rowClass } from "@/components/row-list"
import { countParts } from "@/features/chat/lib/edit-counts"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { useChatStore } from "@/features/chat/store"
import { nameOf, useNames } from "@/lib/actors"
import { clock, dateTime } from "@/lib/time"
import { rpc } from "@/lib/rpc"
import { toastLeft, undoChange } from "@/lib/changes"
import { displayName, type WorkspaceFile } from "../types"
import { toastError, toastUndo } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { capital } from "@/lib/words"

// Every change the log keeps for the doc, newest first, each named by who made it (a typing session is one
// change), with the words it added and took out; a row unfolds to its passages, so the list reads as the
// doc's history and a change can be judged before it is undone. Undo takes that change back passage by
// passage, keeping what was written since; a passage that was itself edited since stays, and the toast
// names it.
export function VersionsDialog({ file, open: shown, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  useNames()
  const [changes, setChanges] = useState<Change[] | null>(null)
  const [stats, setStats] = useState<Record<string, EditStats | null>>({})
  const [open, setOpen] = useState<string | null>(null)
  const chats = useChatStore((s) => s.chats)
  const name = displayName(file.path)

  useEffect(() => {
    if (!shown) return
    let live = true
    rpc.changes
      .list({ target: { kind: "doc", path: file.path } })
      .then((all) => {
        if (!live) return
        setChanges(all)
        // Each change's counts, as they come
        for (const c of all.slice(0, STATS_ROWS))
          void rpc.changes.stats({ ids: [c.id] }).then(
            (got) => live && setStats((s) => ({ ...s, [c.id]: got })),
            () => undefined,
          )
      })
      .catch(() => live && setChanges([]))
    return () => {
      live = false
    }
  }, [shown, file.path])

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
    <Dialog open={shown} onOpenChange={onOpenChange}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading
          title={t`Versions of ${name}`}
          about={t`The changes made to this doc, who made them and what each did, kept for 30 days. Open one to read its passages. Undo takes back one change and keeps what was written after it; a passage edited since stays as it is.`}
        />
        {changes && !changes.length && <p className="py-6 text-center text-sm text-muted-foreground">{t`No changes to this doc are kept.`}</p>}
        {!!changes?.length && (
          <RowList as="ul" className="max-h-96 overflow-y-auto">
            {changes.map((c) => {
              const chatId = c.origin.chatId
              const when = c.until ? `${dateTime(c.at)}–${clock(c.until)}` : dateTime(c.at)
              const title = chatId ? chats[chatId]?.title : undefined
              const who = nameOf(c.actor)
              const counts = stats[c.id] ? countParts(stats[c.id]!) : undefined
              const unfolded = open === c.id
              return (
                <li key={c.id} className="flex flex-col">
                  <div className={cn("group/row flex h-11 items-center gap-2 pr-1 hover:bg-accent", rowClass)}>
                    <button
                      type="button"
                      aria-expanded={unfolded}
                      onClick={() => setOpen(unfolded ? null : c.id)}
                      className="flex min-w-0 flex-1 items-baseline gap-2 text-left outline-none focus-key:underline"
                    >
                      <FoldChevron open={unfolded} className="self-center text-muted-foreground" />
                      <span className="shrink-0 text-sm">{capital(said(c, who))}</span>
                      {counts && (counts.added || counts.removed) && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{[counts.added, counts.removed, counts.unit].filter(Boolean).join(" ")}</span>
                      )}
                      <span className="truncate text-xs text-muted-foreground">{title ? t`${when} · from “${title}”` : chatId ? t`${when} · from a chat` : when}</span>
                    </button>
                    <Button variant="ghost" size="sm" className={revealOnHover} onClick={() => restore(c)}>
                      {t({ message: "Undo", comment: "verb: take back this change to the doc" })}
                    </Button>
                  </div>
                  {unfolded && <Passages id={c.id} />}
                </li>
              )
            })}
          </RowList>
        )}
      </DialogContent>
    </Dialog>
  )
}

// How many rows load their counts: the newest, which are the ones read
const STATS_ROWS = 60
// How many passages an unfolded row shows
const PASSAGES_SHOWN = 8

// An unfolded change's passages, read when it unfolds
function Passages({ id }: { id: string }) {
  const [passages, setPassages] = useState<ProposalHunk[] | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    rpc.changes.passages({ id }).then(
      (got) => live && setPassages(got),
      () => live && setPassages(null),
    )
    return () => {
      live = false
    }
  }, [id])
  if (passages === undefined) return null
  if (!passages?.length) return <p className="px-2 pt-1 pb-3 pl-7.5 text-xs text-muted-foreground">{t`What this change said is no longer kept.`}</p>
  const more = passages.length - PASSAGES_SHOWN
  return (
    <div className="flex flex-col gap-1.5 px-2 pt-1 pb-3 pl-7.5 text-detail leading-relaxed">
      {passages.slice(0, PASSAGES_SHOWN).map((h, i) => (
        <p key={i} className="line-clamp-4 break-words">
          <PassageChange hunk={h} />
        </p>
      ))}
      {more > 0 && <p className="text-xs text-muted-foreground">{plural(more, { one: "and # more passage", other: "and # more passages" })}</p>}
    </div>
  )
}

// What a change did, by whom; who is you, a name, Owlit or outside owlit
function said(c: Change, who: string) {
  if (c.undoes) return t({ message: `Undone by ${who}`, comment: "a change in a doc's Versions; who is you, a name, Owlit or outside owlit" })
  if (c.action === "create") return t({ message: `Made by ${who}`, comment: "a change in a doc's Versions: the doc was made; who is you, a name, Owlit or outside owlit" })
  if (c.action === "delete") return t({ message: `Deleted by ${who}`, comment: "a change in a doc's Versions: the doc was deleted; who is you, a name, Owlit or outside owlit" })
  return t({ message: `Changed by ${who}`, comment: "a change in a doc's Versions; who is you, a name, Owlit or outside owlit" })
}
