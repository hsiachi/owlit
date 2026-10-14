import { plural, t } from "@lingui/core/macro"
import { citedPaperIds, type WorkspaceFile } from "@owlit/protocol"
import { BookOpenIcon, CheckIcon, CopyIcon, LinkIcon, StickyNoteIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { RowList, RowIcon, rowClass } from "@/components/row-list"
import { ChoiceMenu } from "@/components/choice-menu"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { copyText } from "@/lib/clipboard"
import { ago } from "@/lib/time"
import { displayName } from "../types"
import { shares, useShareStore } from "./store"

// Sharing a doc by link: first what the reader will see, then the link itself, who may comment, and the
// author's notes going along or not. Readers need no owlit, only a browser.
export function ShareDialog({ file, open, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const share = useShareStore((s) => s.byPath[file.path])
  const server = useShareStore((s) => s.server)
  const [notes, setNotes] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const name = displayName(file.path)
  const cited = share?.papers ?? citedPaperIds(file.content ?? "").length

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!share || !(await copyText(share.url))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const paperRows = (
    <RowList>
      <div className={cn("flex items-center gap-3 py-2", rowClass)}>
        <RowIcon>
          <BookOpenIcon />
        </RowIcon>
        <div className="min-w-0 flex-1">
          <p>{cited ? plural(cited, { one: "The paper it cites", other: "The # papers it cites" }) : t`The papers it cites`}</p>
          <p className="text-detail text-muted-foreground">{t`Owlit's digest of each and a link to read it. Papers you cite later join them.`}</p>
        </div>
      </div>
      <label className={cn("flex items-center gap-3 py-2", rowClass)}>
        <RowIcon>
          <StickyNoteIcon />
        </RowIcon>
        <div className="min-w-0 flex-1">
          <p>{t`Your notes on those papers`}</p>
          <p className="text-detail text-muted-foreground">{(share ? share.notes : notes) ? t`Readers see them beside each paper` : t`Kept to yourself`}</p>
        </div>
        <Switch
          checked={share ? share.notes : notes}
          disabled={busy || share?.foreign}
          onCheckedChange={(on) => (share ? void run(() => shares.update(file.path, { notes: on })) : setNotes(on))}
          aria-label={t`Share your notes on the papers`}
        />
      </label>
    </RowList>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title={t`Share “${name}”`} about={t`Anyone with the link reads the doc in a browser, without owlit, and can comment on it. Comments come back here.`} />
        {!share ? (
          <>
            <p className="text-detail text-muted-foreground">{t`Make a link to send. Whoever opens it reads the doc and comments in their browser.`}</p>
            <div className="flex flex-col gap-1">
              <p className="px-1 text-xs text-muted-foreground">{t`They also see`}</p>
              {paperRows}
            </div>
            <p className="px-1 text-detail text-muted-foreground">{t`Your changes reach readers as you make them. Your chats, highlights and other docs stay here.`}</p>
            {!server && <p className="px-1 text-detail text-destructive">{t`No share server is set up, so owlit can't make links yet.`}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t`Cancel`}
              </Button>
              <Button disabled={busy || !server} onClick={() => void run(() => shares.create(file.path, notes))}>
                <LinkIcon />
                {t`Create link`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <LinkIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1">{t`Anyone with the link`}</span>
              <ChoiceMenu
                label={t`Who may comment`}
                value={share.permission}
                options={[
                  { value: "comment", label: t`Can comment` },
                  { value: "view", label: t`Can only read` },
                ]}
                onChange={(permission) => void run(() => shares.update(file.path, { permission }))}
              />
            </div>
            <div className="flex gap-2">
              <input readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} aria-label={t`Link`} className="h-8 min-w-0 flex-1 rounded-[10px] border border-input bg-transparent px-2.5 font-mono text-detail outline-none focus:border-ring" />
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? t`Copied` : t`Copy link`}
              </Button>
            </div>
            <div className="flex flex-col gap-1">
              <p className="px-1 text-xs text-muted-foreground">{t`Readers also see`}</p>
              {paperRows}
            </div>
            {share.foreign ? (
              <p className="px-1 text-detail text-muted-foreground">{t`This doc was shared from another computer; only that one can change its link.`}</p>
            ) : share.problem ? (
              <p className="px-1 text-detail text-destructive">{share.problem}</p>
            ) : (
              <p className="px-1 text-detail text-muted-foreground">{share.pushedAt ? t`Readers have the doc as it was ${ago(share.pushedAt, { inSentence: true })}.` : t`Readers have the latest version.`}</p>
            )}
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || share.foreign} onClick={() => void run(() => shares.stop(file.path).then(() => onOpenChange(false)))}>
                {t`Stop sharing`}
              </Button>
              <Button onClick={() => onOpenChange(false)}>{t`Done`}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
