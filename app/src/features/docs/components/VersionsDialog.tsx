import { useEffect, useState } from "react"
import type { VersionInfo } from "@owlit/protocol"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useChatStore } from "@/features/chat/store"
import { shortDate } from "@/features/knowledge/lib/when"
import { rpc } from "@/lib/rpc"
import { undoChange } from "@/lib/versions"
import { displayName, type WorkspaceFile } from "../types"

const time = (t: number) => `${shortDate(t)}, ${new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`

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
        toast("Version restored", { description: name, action: { label: "Undo", onClick: () => undoChange(redoId, name) } })
      })
      .catch((error: Error) => toast.error(error.message))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Versions of {name}</DialogTitle>
          <DialogDescription>The text from before each change Owlit made, kept for 30 days.</DialogDescription>
        </DialogHeader>
        {versions && !versions.length && <p className="py-6 text-center text-sm text-muted-foreground">Owlit hasn't changed this doc.</p>}
        {!!versions?.length && (
          <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
            {versions.map((v) => {
              const chat = v.chatId ? chats[v.chatId] : undefined
              return (
                <li key={v.id} className="group/version flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{v.by === "undo" ? "Before an undo" : "Before Owlit's edit"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {time(v.at)}
                      {chat ? ` · from “${chat.title || "a chat"}”` : v.chatId ? " · from a chat" : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover/version:opacity-100 focus-visible:opacity-100" onClick={() => restore(v)}>
                    Restore
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
