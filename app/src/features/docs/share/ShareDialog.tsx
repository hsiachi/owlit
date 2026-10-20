import { plural, t } from "@lingui/core/macro"
import { citedPaperIds, type WorkspaceFile } from "@owlit/protocol"
import { CheckIcon, CopyIcon, LinkIcon } from "lucide-react"
import { useState } from "react"
import { ChoiceMenu } from "@/components/choice-menu"
import { FormRow } from "@/components/form-row"
import { GroupLabel } from "@/components/group-label"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useCopyFlash } from "@/hooks/use-copy-flash"
import { copyText } from "@/lib/clipboard"
import { toastError } from "@/lib/toast"
import { ago } from "@/lib/time"
import { displayName } from "../types"
import { shares, unreachable, useShareStore } from "./store"

// Sharing a doc by link: first what the reader will see, then the link itself, who may comment, and the
// author's notes going along or not. Readers need no owlit, only a browser.
export function ShareDialog({ file, open, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const share = useShareStore((s) => s.byPath[file.path])
  const server = useShareStore((s) => s.server)
  const [notes, setNotes] = useState(true)
  const [busy, setBusy] = useState(false)
  // Stop sharing couldn't reach the server: the way out is to forget the link here
  const [stopFailed, setStopFailed] = useState(false)
  const [copied, flash] = useCopyFlash()
  const name = displayName(file.path)
  const cited = share?.papers ?? citedPaperIds(file.content ?? "").length

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await work()
    } catch (error) {
      toastError(error)
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    setBusy(true)
    try {
      await shares.stop(file.path)
      onOpenChange(false)
    } catch (error) {
      if (unreachable(error)) setStopFailed(true)
      else toastError(error)
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!share || !(await copyText(share.url))) return
    flash()
  }

  // What goes along with the doc, as Settings rows: the papers (always), the notes (a switch)
  const paperRows = (
    <div className="divide-y">
      <FormRow
        name={cited ? plural(cited, { one: "The paper it cites", other: "The # papers it cites" }) : t`The papers it cites`}
        help={t`Owlit's digest of each and a link to read it. Papers you cite later join them.`}
      />
      <FormRow
        name={t`Your notes on those papers`}
        help={(share ? share.notes : notes) ? t`Readers see them beside each paper` : t`Kept to yourself`}
        control={
          <Switch
            checked={share ? share.notes : notes}
            disabled={busy || share?.foreign}
            onCheckedChange={(on) => (share ? void run(() => shares.update(file.path, { notes: on })) : setNotes(on))}
            aria-label={t`Share your notes on the papers`}
          />
        }
      />
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setStopFailed(false)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title={t`Share “${name}”`} about={t`Anyone with the link reads the doc in a browser, without owlit, and can comment on it. Comments come back here.`} />
        {!share ? (
          <>
            <p className="text-detail text-muted-foreground">{t`Make a link to send. Whoever opens it reads the doc and comments in their browser.`}</p>
            <div>
              <GroupLabel as="div" flush className="mb-0">
                {t`They also see`}
              </GroupLabel>
              {paperRows}
            </div>
            <p className="text-detail text-muted-foreground">{t`Your changes reach readers as you make them. Your chats, highlights and other docs stay here.`}</p>
            <p className="text-detail text-muted-foreground">{t`The link works until you stop sharing. It's signed with your name.`}</p>
            {!server && <p className="text-detail text-destructive">{t`No share server is set up, so owlit can't make links yet.`}</p>}
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
              <Input readOnly value={share.url} onFocus={(e) => e.currentTarget.select()} aria-label={t`Link`} className="min-w-0 flex-1 font-mono text-detail md:text-detail" />
              <Button variant="outline" onClick={() => void copy()}>
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? t`Copied` : t`Copy link`}
              </Button>
            </div>
            <div>
              <GroupLabel as="div" flush className="mb-0">
                {t`Readers also see`}
              </GroupLabel>
              {paperRows}
            </div>
            {stopFailed ? (
              <p className="text-detail text-destructive">{t`The share server can't be reached, so the link can't be stopped there now. Forget it here, and it may still open for readers until the server is back.`}</p>
            ) : share.oldServer ? (
              <p className="text-detail text-muted-foreground">
                {t`This link is on a share server owlit no longer uses.`}{" "}
                <Button variant="text" size="inline" disabled={busy} onClick={() => void run(() => shares.create(file.path, share.notes))}>
                  {t`Make a new link`}
                </Button>
              </p>
            ) : share.foreign ? (
              <p className="text-detail text-muted-foreground">{t`This doc was shared from another computer; only that one can change its link.`}</p>
            ) : share.problem ? (
              <p className="text-detail text-destructive">{share.problem}</p>
            ) : share.held ? (
              <p className="text-detail text-muted-foreground">{t`Owlit's latest edits reach readers once you've seen them in the doc.`}</p>
            ) : (
              <p className="text-detail text-muted-foreground">{share.pushedAt ? t`Readers have the doc as it was ${ago(share.pushedAt, { inSentence: true })}.` : t`Readers have the latest version.`}</p>
            )}
            <DialogFooter className="sm:justify-between">
              {/* No Undo after stopping: a stopped link can't open again, so there is nothing to take back */}
              {stopFailed ? (
                <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void run(() => shares.forget(file.path).then(() => onOpenChange(false)))}>
                  {t`Forget this link here`}
                </Button>
              ) : (
                <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy || share.foreign} onClick={() => void stop()}>
                  {t`Stop sharing`}
                </Button>
              )}
              <Button onClick={() => onOpenChange(false)}>{t`Done`}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
