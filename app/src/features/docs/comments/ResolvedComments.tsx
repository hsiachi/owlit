import { plural, t } from "@lingui/core/macro"
import { DialogHeading } from "@/components/info"
import { RowList, revealOnHover, rowClass } from "@/components/row-list"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { ago } from "@/lib/time"
import { shorten } from "@/lib/words"
import { cn } from "@/lib/utils"
import { displayName, type WorkspaceFile } from "../types"
import { useDocsUiStore } from "../ui-store"
import { useResolvedViews } from "./hooks"
import { reopen } from "./model"

// The comments put away on a doc, newest first, from the doc's ⋯: what was said, on which words, and
// Reopen, which puts the comment back and opens it beside its words, so you see where it went
export function ResolvedComments({ file, open, onOpenChange }: { file: WorkspaceFile; open: boolean; onOpenChange: (open: boolean) => void }) {
  const views = useResolvedViews(file.id)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title={t`Resolved comments on ${displayName(file.path)}`} />
        {!views.length && <p className="py-6 text-center text-sm text-muted-foreground">{t`No resolved comments.`}</p>}
        {!!views.length && (
          <RowList as="ul" className="max-h-96 overflow-y-auto">
            {views.map((v) => {
              const first = v.entries[0]
              const replies = v.entries.length - 1
              return (
                <li key={v.key} className={cn("group/row flex items-start gap-3 py-2 pr-1 hover:bg-accent", rowClass)}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{first.name}</span>
                      {" · "}
                      {ago(first.at)}
                      {replies > 0 ? ` · ${plural(replies, { one: "# reply", other: "# replies" })}` : ""}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-sm">{first.text}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{t`On “${shorten(v.quote, 80)}”`}</p>
                  </div>
                  <Button variant="ghost" size="sm" className={revealOnHover} onClick={() => {
                      reopen(file.id, v)
                      onOpenChange(false)
                      useDocsUiStore.getState().setOpenComment(file.id, v.key)
                    }}>
                    {t({ message: "Reopen", comment: "put a resolved comment back beside its words" })}
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
