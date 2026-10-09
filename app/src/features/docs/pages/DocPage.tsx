import { Fragment, useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { EllipsisVerticalIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { saveAgain } from "../disk"
import { DocEditor } from "../editor/DocEditor"
import { anchor } from "../editor/agent-notes"
import { useDocsStore } from "../store"
import { displayName, isMarkdown, parentPath } from "../types"
import { useDocsUiStore } from "../ui-store"

// One doc: a one-line header with where it lives, then the text in the reading column
export function DocPage() {
  const { docId = "" } = useParams()
  const navigate = useNavigate()
  const file = useDocsStore((s) => s.files[docId])
  const loaded = useDocsStore((s) => s.loaded)
  const folder = file ? parentPath(file.path) : ""

  // The panel follows the open doc: its folder opens (and folders opened only for the last doc close), and
  // new docs land beside it
  useEffect(() => {
    if (!file) return
    const ui = useDocsUiStore.getState()
    ui.openedDoc(file.id, folder)
    ui.revealDoc(folder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, folder])

  if (!file && !loaded) return null
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
      {/* Starts at the sheet's edge, as the paper page's breadcrumb does, rather than at the text column */}
      <header className="flex h-11 shrink-0 items-center gap-1 pr-2.5 pl-4 text-[13px]">
        <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-1 text-muted-foreground">
          {folder
            .split("/")
            .filter(Boolean)
            .map((part, i, parts) => {
              const path = parts.slice(0, i + 1).join("/")
              return (
                <Fragment key={path}>
                  {/* A folder shows itself in the list, selected, so a new doc lands there */}
                  <button
                    type="button"
                    onClick={() => {
                      useDocsUiStore.getState().expandTo(path)
                      useDocsUiStore.getState().selectFolder(path)
                    }}
                    className="-mx-1 shrink-0 rounded-md px-1 py-0.5 outline-hidden transition-colors hover:bg-accent hover:text-foreground focus-key:bg-accent"
                  >
                    {part}
                  </button>
                  <span className="shrink-0 px-0.5">/</span>
                </Fragment>
              )
            })}
          <span className="truncate text-foreground">{displayName(file.path)}</span>
        </nav>
        <DeletedOnDisk docId={file.id} />
        <NoteCount docId={file.id} />
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

// Shown while the open doc has been deleted on disk by something else: the text stays readable and
// Save again writes it back
function DeletedOnDisk({ docId }: { docId: string }) {
  const missing = useDocsStore((s) => !!s.missing[docId])
  if (!missing) return null
  return (
    <>
      <span className="shrink-0 px-1 text-muted-foreground">Deleted on disk</span>
      <Button variant="ghost" size="sm" onClick={() => saveAgain(docId)} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
        Save again
      </Button>
    </>
  )
}

// Shown only when agents left notes on the doc: "2 notes", which opens them one after another in reading order
function NoteCount({ docId }: { docId: string }) {
  const notes = useDocsStore((s) => s.notes[docId])
  const open = useDocsUiStore((s) => (s.openNote?.docId === docId ? s.openNote.noteId : null))
  if (!notes?.length) return null

  const next = () => {
    const text = useDocsStore.getState().files[docId]?.content ?? ""
    // Notes whose passage is gone sort first, as they sit beside the title
    const ordered = [...notes].sort((a, b) => (anchor(text, a) ?? -1) - (anchor(text, b) ?? -1))
    const i = ordered.findIndex((n) => n.id === open)
    useDocsUiStore.getState().setOpenNote(docId, ordered[(i + 1) % ordered.length].id)
  }

  return (
    <Button variant="ghost" size="sm" onClick={next} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
      {notes.length} {notes.length === 1 ? "note" : "notes"}
    </Button>
  )
}
