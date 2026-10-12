import { LARGE_FILE_BYTES } from "@owlit/protocol"
import { BorderedList } from "@/components/bordered-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { formatBytes } from "../../lib/attachments"

const ABOUT_COPIES = "owlit keeps a copy of each file you attach with the chat, inside the workspace, so the chat still has it when the original moves or changes."

// Files over LARGE_FILE_BYTES ask once before they are copied (useAttachments' `large`)
export function LargeFilesDialog({ files, onAnswer }: { files: File[] | null; onAnswer: (how: "copy" | "skip" | null) => void }) {
  const big = files?.filter((f) => f.size > LARGE_FILE_BYTES) ?? []
  return (
    <Dialog open={!!files} onOpenChange={(open) => !open && onAnswer(null)}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title={big.length === 1 ? "Copy this large file?" : `Copy ${big.length} large files?`} about={ABOUT_COPIES} />
        <BorderedList as="ul">
          {big.map((f, i) => (
            <li key={i} className="flex h-9 items-center gap-3 px-3.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
            </li>
          ))}
        </BorderedList>
        <DialogFooter>
          {/* The smaller ones dropped with them are still attached */}
          <Button variant="ghost" onClick={() => onAnswer("skip")}>
            {files && files.length > big.length ? "Skip large files" : "Cancel"}
          </Button>
          <Button onClick={() => onAnswer("copy")}>Copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
