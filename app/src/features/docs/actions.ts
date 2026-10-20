import { plural, t } from "@lingui/core/macro"
import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import { mentionLink } from "@owlit/protocol"
import type { MenuGroups } from "@/components/action-menu"
import { copyText } from "@/lib/clipboard"
import { canReveal, rpc } from "@/lib/rpc"
import { openEditor } from "./editors"
import { useDocsStore, type Removed } from "./store"
import { baseName, displayName, docUri, isMarkdown, isWithin, type WorkspaceFile } from "./types"
import { folderOfKey, rowKey, useDocsUiStore } from "./ui-store"
import { useNewDoc } from "./use-new-doc"
import { resolvedViews } from "./comments/model"
import { useShareStore } from "./share/store"
import { toastError, toastUndo } from "@/lib/toast"
import { copyReferences } from "@/features/library/actions"
import { reviewImport } from "@/features/library/imports"
import { useWorkspace } from "@/lib/workspace"

const undoToast = (title: string, description: string | undefined, removed: Removed) =>
  toastUndo(title, () => useDocsStore.getState().restore(removed), { description })

// Renaming waits a tick, so a closing menu doesn't take the focus back from the input
const startRenaming = (key: string) => setTimeout(() => useDocsUiStore.getState().setRenaming(key), 0)

// The picked rows that act as themselves: a picked folder carries what is inside it, so a doc or folder
// picked inside it isn't counted or handled again
export function topLevel(keys: string[]) {
  const { files } = useDocsStore.getState()
  const folders = keys.map(folderOfKey).filter((p): p is string => p !== null)
  const top = folders.filter((f) => !folders.some((o) => o !== f && isWithin(f, o)))
  const loose = keys.filter((k) => folderOfKey(k) === null && files[k] && !top.some((f) => isWithin(files[k].path, f)))
  return { folders: top, files: loose, count: top.length + loose.length }
}

// A doc as it reads now, typing not yet saved included
const docText = (file: WorkspaceFile) => openEditor(file.id)?.state.doc.toString() ?? file.content ?? ""

const reveal = (path: string) => void rpc.docs.reveal({ path }).catch(toastError)

// What can be done to docs and folders, the same from a row's ⋯, a right-click, the doc's header and the
// keyboard
export function useDocActions() {
  const navigate = useNavigate()
  const { docId: activeId } = useParams()
  const newDoc = useNewDoc()

  const leaveIfRemoved = (removed: Removed) => {
    if (activeId && removed.files.some((f) => f.id === activeId)) navigate("/docs", { replace: true })
  }

  const duplicate = (file: WorkspaceFile) => {
    // The copy holds the doc as it reads now, typing not yet saved included
    const text = openEditor(file.id)?.state.doc.toString() ?? file.content ?? ""
    const copy = useDocsStore.getState().duplicateDoc(file.id, text)
    if (copy) navigate(`/docs/${copy.id}`)
  }

  // A link to the doc, the same one @ writes, so pasted into another doc it reads as a mention and
  // follows the doc through renames and moves
  const copyLink = async (file: WorkspaceFile) => {
    if (await copyText(mentionLink(displayName(file.path), docUri(file.path)))) toast(t`Link copied`)
  }

  const deleteFile = (file: WorkspaceFile) => {
    const removed = useDocsStore.getState().deleteFile(file.id)
    leaveIfRemoved(removed)
    undoToast(t`Doc deleted`, displayName(file.path), removed)
  }

  const deleteFolder = (path: string) => {
    const ui = useDocsUiStore.getState()
    const removed = useDocsStore.getState().deleteFolder(path)
    leaveIfRemoved(removed)
    if (ui.selectedFolder && isWithin(ui.selectedFolder, path)) ui.selectFolder(null)
    const n = removed.files.length
    const name = baseName(path)
    undoToast(t`Folder deleted`, n ? plural(n, { one: `${name} and # file`, other: `${name} and # files` }) : name, removed)
  }

  // Several rows at once, as one change with one Undo. What sits inside a picked folder goes with it.
  const deleteKeys = (keys: string[]) => {
    const { files } = useDocsStore.getState()
    const { folders: top, files: loose, count } = topLevel(keys)
    if (count === 1) return top.length ? deleteFolder(top[0]) : deleteFile(files[loose[0]])
    const store = useDocsStore.getState()
    const removed: Removed = { files: [], folders: [] }
    for (const f of top) {
      const r = store.deleteFolder(f)
      removed.files.push(...r.files)
      removed.folders.push(...r.folders)
    }
    for (const id of loose) removed.files.push(...store.deleteFile(id).files)
    leaveIfRemoved(removed)
    useDocsUiStore.getState().setPicked([], null)
    const ui = useDocsUiStore.getState()
    if (ui.selectedFolder && top.some((f) => isWithin(ui.selectedFolder!, f))) ui.selectFolder(null)
    undoToast(plural(count, { one: "# item deleted", other: "# items deleted" }), undefined, removed)
  }

  const fileGroups = (file: WorkspaceFile): MenuGroups => {
    const md = isMarkdown(file.path)
    return [
      [
        { label: t`Rename`, onSelect: () => startRenaming(rowKey.file(file.id)) },
        ...(md ? [{ label: t`Duplicate`, onSelect: () => duplicate(file) }] : []),
        ...(md
          ? [
              {
                label: t`Copy references`,
                children: [
                  { label: t({ message: "As APA text", comment: "copy a doc's references as APA-formatted text" }), onSelect: () => void copyReferences(docText(file), "apa") },
                  { label: t({ message: "As BibTeX", comment: "copy a doc's references as a .bib file's entries" }), onSelect: () => void copyReferences(docText(file), "bibtex") },
                ],
              },
            ]
          : []),
        ...(md ? [{ label: t`Versions…`, onSelect: () => useDocsUiStore.getState().showVersions(file.id) }] : []),
        // Only once something was put away: the way back to a comment after its Undo has gone
        ...(md && resolvedViews(useDocsStore.getState().comments[file.id], useShareStore.getState().comments[file.path]).length
          ? [{ label: t`Resolved comments…`, onSelect: () => useDocsUiStore.getState().showResolved(file.id) }]
          : []),
      ],
      [
        ...(md ? [{ label: t`Copy link`, onSelect: () => void copyLink(file) }] : []),
        ...(canReveal ? [{ label: t`Show in Finder`, onSelect: () => reveal(file.path) }] : []),
      ],
      [{ label: t`Delete`, destructive: true, onSelect: () => deleteFile(file) }],
    ]
  }

  const folderGroups = (path: string): MenuGroups => {
    const ui = useDocsUiStore.getState()
    return [
      [
        {
          label: t`New doc`,
          onSelect: () => {
            ui.expandTo(path)
            newDoc(path)
          },
        },
        {
          label: t`New folder`,
          onSelect: () => {
            const made = useDocsStore.getState().createFolder(path)
            ui.expandTo(path)
            startRenaming(rowKey.folder(made))
          },
        },
        { label: t`Rename`, onSelect: () => startRenaming(rowKey.folder(path)) },
      ],
      canReveal ? [{ label: t`Show in Finder`, onSelect: () => reveal(path) }] : [],
      // A folder of nothing but PDFs is papers kept as files: the Library takes them in (moving them
      // there, since the folder is inside the workspace)
      onlyPdfs(path) ? [{ label: t`Import as papers…`, onSelect: () => importAsPapers(path) }] : [],
      [{ label: t`Delete`, destructive: true, onSelect: () => deleteFolder(path) }],
    ]
  }

  const importAsPapers = (path: string) => {
    const root = useWorkspace.getState().current?.path
    if (!root) return
    navigate("/library")
    reviewImport("folder", `${root}/${path}`)
  }

  const pickedGroups = (keys: string[]): MenuGroups => {
    const { count } = topLevel(keys)
    return [[{ label: count === 1 ? t`Delete` : plural(count, { one: "Delete # item", other: "Delete # items" }), destructive: true, onSelect: () => deleteKeys(keys) }]]
  }

  return { fileGroups, folderGroups, pickedGroups, deleteKeys, startRenaming }
}

// Whether a folder holds files, and every one a PDF (core's import reads it from disk)
function onlyPdfs(folder: string) {
  const inside = Object.values(useDocsStore.getState().files).filter((f) => isWithin(f.path, folder))
  return inside.length > 0 && inside.every((f) => /\.pdf$/i.test(f.path))
}
