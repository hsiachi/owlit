import { plural, t } from "@lingui/core/macro"
import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { EllipsisVerticalIcon } from "lucide-react"
import { ActionsDropdownContent } from "@/components/action-menu"
import { NotFound, PageHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useDocActions } from "../actions"
import { saveAgain } from "../disk"
import { DocEditor } from "../editor/DocEditor"
import { anchor } from "../editor/agent-notes"
import { isHidden } from "../lib/tree"
import { useDocsStore } from "../store"
import { displayName, isMarkdown, parentPath } from "../types"
import { useDocsUiStore } from "../ui-store"
import { DocShareControls } from "../share/DocShareControls"

// One doc: a one-line header with where it lives, then the text in the reading column
export function DocPage() {
  const { docId = "" } = useParams()
  const file = useDocsStore((s) => s.files[docId])
  const loaded = useDocsStore((s) => s.loaded)
  const folder = file ? parentPath(file.path) : ""
  const { fileGroups } = useDocActions()

  // The panel follows the open doc: its folder opens (and folders opened only for the last doc close), and
  // new docs land beside it. A file the tree hides (a Knowledge topic opened from a link) leaves both alone.
  useEffect(() => {
    if (!file || isHidden(file.path)) return
    const ui = useDocsUiStore.getState()
    ui.openedDoc(file.id, folder)
    ui.revealDoc(folder)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, folder])

  if (!file && !loaded) return null
  if (!file || !isMarkdown(file.path))
    return (
      <NotFound title={t`This doc is not in the workspace`} detail={t`It may have been moved or deleted.`} back={{ label: t`Back to docs`, to: "/docs" }} />
    )

  // A folder shows itself in the list, selected, so a new doc lands there
  const trail = folder
    .split("/")
    .filter(Boolean)
    .map((part, i, parts) => {
      const path = parts.slice(0, i + 1).join("/")
      return {
        label: part,
        onClick: () => {
          useDocsUiStore.getState().expandTo(path)
          useDocsUiStore.getState().selectFolder(path)
        },
      }
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader trail={trail} current={displayName(file.path)}>
        <DeletedOnDisk docId={file.id} />
        <NoteCount docId={file.id} />
        <DocShareControls file={file} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t`Doc actions`} className="text-muted-foreground">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          {/* The same actions as the doc's row in the list */}
          <ActionsDropdownContent groups={fileGroups(file)} align="end" />
        </DropdownMenu>
      </PageHeader>
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
      <span className="shrink-0 px-1 text-muted-foreground">{t`Deleted on disk`}</span>
      <Button variant="ghost" size="sm" onClick={() => saveAgain(docId)} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
        {t`Save again`}
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
      {plural(notes.length, { one: "# note", other: "# notes" })}
    </Button>
  )
}
