import { t } from "@lingui/core/macro"
import { useEffect, useRef, useState } from "react"
import { useParams } from "react-router-dom"
import { isProjectMark } from "@owlit/protocol"
import { ActionsDropdownContent, MenuButton, MenuItems, type MenuGroups } from "@/components/action-menu"
import { NotFound, PageHeader } from "@/components/page"
import { Button } from "@/components/ui/button"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { useDocActions } from "../actions"
import { saveAgain } from "../disk"
import { DocEditor } from "../editor/DocEditor"
import { isHidden } from "../lib/tree"
import { useDocsStore } from "../store"
import { displayName, isMarkdown, parentPath } from "../types"
import { useDocsUiStore } from "../ui-store"
import { DocShareControls } from "../share/DocShareControls"
import { CommentColumn } from "../comments/CommentColumn"
import { openEditor } from "../editors"
import { setInlineCards } from "../editor/comment-marks"
import { useCommentSteps, useCommentViews } from "../comments/hooks"
import { CommentsToggle } from "../comments/CommentsToggle"
import { cn } from "@/lib/utils"

// One doc: a one-line header with where it lives, then the text in the reading column
export function DocPage() {
  const { docId = "" } = useParams()
  const file = useDocsStore((s) => s.files[docId])
  const loaded = useDocsStore((s) => s.loaded)
  const folder = file ? parentPath(file.path) : ""
  const { fileGroups } = useDocActions()

  // The panel follows the open doc: its folder opens (and folders opened only for the last doc close), and
  // new docs land beside it. A file the tree hides leaves both alone.
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
        <CommentsToggle file={file} />
        <DocShareControls file={file} />
        <DropdownMenu>
          <MenuButton label={t`Doc actions`} />
          {/* The same actions as the doc's row in the list */}
          {/* Built as the menu opens, so it shows what is true then (Resolved comments… once one was) */}
          <ActionsDropdownContent align="end">
            <DocMenuItems groups={() => fileGroups(file)} />
          </ActionsDropdownContent>
        </DropdownMenu>
      </PageHeader>
      <DocBody docId={file.id}>
        {isProjectMark(file.path) && <ProjectMarkLine />}
        <DocEditor key={file.id} file={file} />
      </DocBody>
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

// Above a project mark's text: the one place that says what the file does, since nothing else in the app
// explains it. A muted line, like the doc's other lines about itself, so the text stays the doc's own.
function ProjectMarkLine() {
  return <p className="pb-2 text-detail text-muted-foreground">{t`This folder is a project. The first line is its name; status:, due: and current: are optional.`}</p>
}

function DocMenuItems({ groups }: { groups: () => MenuGroups }) {
  return <MenuItems groups={groups()} />
}

// The reading column, and the doc's comments in a column to its right. Wide enough, the doc stays centred
// with the comments in the margin; less wide, the two are centred together, the column a little slimmer
// and the text narrower before anything folds; too narrow for both, the comments fold to pins at the doc's
// edge and an open card goes into the text (CommentColumn).
const DOC = 768
const GAP = 40
const COLUMN = 272
const SLIM = 240
// The narrowest the text gets beside the column: about 65 characters of the doc's 15px type
const DOC_MIN = 520
function DocBody({ docId, children }: { docId: string; children: React.ReactNode }) {
  const main = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = main.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(el)
    return () => resized.disconnect()
  }, [])
  const shown = useDocsUiStore((s) => s.commentsShown)
  const drafting = useDocsUiStore((s) => s.newComment?.docId === docId)
  const any = useCommentViews(docId).length > 0
  const column = shown && (any || drafting)
  // 48px of side padding around the pair
  const layout = !column ? "alone" : width >= DOC + 2 * (COLUMN + GAP) ? "margin" : width >= DOC_MIN + SLIM + GAP + 48 ? "beside" : "pins"
  const columnWidth = layout === "beside" && width < DOC + COLUMN + GAP + 48 ? SLIM : COLUMN
  const pins = layout === "pins"
  useCommentSteps(docId)
  // The editor draws the slot for an open card only while the column is folded
  useEffect(() => {
    openEditor(docId)?.dispatch({ effects: setInlineCards.of(pins) })
  }, [docId, pins])
  return (
    <main ref={main} data-tour="doc" className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          "mx-auto px-6 pt-6",
          layout === "alone" && "max-w-3xl",
          layout === "margin" && "grid grid-cols-[1fr_minmax(0,48rem)_1fr] items-start px-0",
          layout === "beside" && "flex items-start gap-10",
          layout === "pins" && "flex max-w-[calc(48rem+2.5rem)] items-start gap-3",
        )}
        // Beside, the text keeps its own measure and the pair is centred
        style={layout === "beside" ? { maxWidth: DOC + GAP + columnWidth + 48 } : undefined}
      >
        <div className={cn("min-w-0", layout === "margin" ? "col-start-2 px-6" : "flex-1")}>{children}</div>
        {column && (
          <div className={cn(layout === "margin" && "col-start-3 flex justify-start pr-6 pl-4", layout !== "margin" && "contents")}>
            <CommentColumn fileId={docId} pins={pins} width={columnWidth} />
          </div>
        )}
      </div>
    </main>
  )
}
