import { plural, t } from "@lingui/core/macro"
import { LARGE_FILE_BYTES } from "@owlit/protocol"
import { RowList, rowClass } from "@/components/row-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { formatBytes } from "../../lib/attachments"
import { cn } from "@/lib/utils"

// Files over LARGE_FILE_BYTES ask once before they are copied (useAttachments' `large`)
export function LargeFilesDialog({ files, onAnswer }: { files: File[] | null; onAnswer: (how: "copy" | "skip" | null) => void }) {
  const big = files?.filter((f) => f.size > LARGE_FILE_BYTES) ?? []
  const about = t`owlit keeps a copy of each file you attach with the chat, inside the workspace, so the chat still has it when the original moves or changes.`
  return (
    <Dialog open={!!files} onOpenChange={(open) => !open && onAnswer(null)}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title={plural(big.length, { one: "Copy this large file?", other: "Copy # large files?" })} about={about} />
        <RowList as="ul">
          {big.map((f, i) => (
            <li key={i} className={cn("flex h-9 items-center gap-3 text-sm", rowClass)}>
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
            </li>
          ))}
        </RowList>
        <DialogFooter>
          {/* The smaller ones dropped with them are still attached */}
          <Button variant="ghost" onClick={() => onAnswer("skip")}>
            {files && files.length > big.length ? t`Skip large files` : t`Cancel`}
          </Button>
          <Button onClick={() => onAnswer("copy")}>{t({ message: "Copy", comment: "verb: copy the large files into the workspace" })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
