import { Fragment, useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { EllipsisVerticalIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DocEditor } from "../editor/DocEditor"
import { useDocsStore } from "../store"
import { displayName, isMarkdown, parentPath } from "../types"
import { useDocsUiStore } from "../ui-store"

// One doc: a one-line header with where it lives, then the text in the reading column
export function DocPage() {
  const { docId = "" } = useParams()
  const navigate = useNavigate()
  const file = useDocsStore((s) => s.files[docId])
  const folder = file ? parentPath(file.path) : ""

  // The panel follows the open doc: its folder opens, and new docs land beside it
  useEffect(() => {
    if (!file) return
    const ui = useDocsUiStore.getState()
    ui.openedDoc(file.id, folder)
    if (folder) ui.expandTo(folder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, folder])

  if (!file || !isMarkdown(file.path)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-[15px] font-medium">This doc is not in the workspace</p>
        <p className="text-sm text-muted-foreground">It may have been moved or deleted.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/docs")}>
          Back to docs
        </Button>
      </div>
    )
  }

  const remove = () => {
    const removed = useDocsStore.getState().deleteFile(file.id)
    navigate("/docs", { replace: true })
    toast("Doc deleted", {
      description: displayName(file.path),
      action: { label: "Undo", onClick: () => useDocsStore.getState().restore(removed) },
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-1 pr-2.5 pl-4 text-[13px]">
        <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
          {folder.split("/").filter(Boolean).map((part) => (
            <Fragment key={part}>
              <span className="shrink-0">{part}</span>
              <span className="shrink-0">/</span>
            </Fragment>
          ))}
          <span className="truncate text-foreground">{displayName(file.path)}</span>
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Doc actions" className="text-muted-foreground">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => setTimeout(() => useDocsUiStore.getState().setRenaming(file.id), 0)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pt-6">
          <DocEditor key={file.id} file={file} />
        </div>
      </main>
    </div>
  )
}
