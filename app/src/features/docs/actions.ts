import { useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"
import type { MenuGroups } from "@/components/action-menu"
import { copyText } from "@/features/library/lib/clipboard"
import { isDesktop, rpc } from "@/lib/rpc"
import { openEditor } from "./editors"
import { useDocsStore, type Removed } from "./store"
import { displayName, docUri, isMarkdown, isWithin, type WorkspaceFile } from "./types"
import { folderOfKey, rowKey, useDocsUiStore } from "./ui-store"
import { useNewDoc } from "./use-new-doc"

function undoToast(title: string, description: string | undefined, removed: Removed) {
  toast(title, {
    description,
    action: { label: "Undo", onClick: () => useDocsStore.getState().restore(removed) },
  })
}

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

const reveal = (path: string) => void rpc.docs.reveal({ path }).catch((error: Error) => toast.error(error.message))

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
    if (await copyText(`[${displayName(file.path)}](${docUri(file.path)})`)) toast("Link copied")
  }

  const deleteFile = (file: WorkspaceFile) => {
    const removed = useDocsStore.getState().deleteFile(file.id)
    leaveIfRemoved(removed)
    undoToast("Doc deleted", displayName(file.path), removed)
  }

  const deleteFolder = (path: string) => {
    const ui = useDocsUiStore.getState()
    const removed = useDocsStore.getState().deleteFolder(path)
    leaveIfRemoved(removed)
    if (ui.selectedFolder && isWithin(ui.selectedFolder, path)) ui.selectFolder(null)
    const n = removed.files.length
    const name = path.split("/").pop() ?? path
    undoToast("Folder deleted", n ? `${name} and ${n} ${n === 1 ? "file" : "files"}` : name, removed)
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
    undoToast(`${count} items deleted`, undefined, removed)
  }

  const fileGroups = (file: WorkspaceFile): MenuGroups => {
    const md = isMarkdown(file.path)
    return [
      [
        { label: "Rename", onSelect: () => startRenaming(rowKey.file(file.id)) },
        ...(md ? [{ label: "Duplicate", onSelect: () => duplicate(file) }] : []),
        ...(md && isDesktop ? [{ label: "Versions…", onSelect: () => useDocsUiStore.getState().showVersions(file.id) }] : []),
      ],
      [
        ...(md ? [{ label: "Copy link", onSelect: () => void copyLink(file) }] : []),
        ...(isDesktop ? [{ label: "Show in Finder", onSelect: () => reveal(file.path) }] : []),
      ],
      [{ label: "Delete", destructive: true, onSelect: () => deleteFile(file) }],
    ]
  }

  const folderGroups = (path: string): MenuGroups => {
    const ui = useDocsUiStore.getState()
    return [
      [
        {
          label: "New doc",
          onSelect: () => {
            ui.expandTo(path)
            newDoc(path)
          },
        },
        {
          label: "New folder",
          onSelect: () => {
            const made = useDocsStore.getState().createFolder(path)
            ui.expandTo(path)
            startRenaming(rowKey.folder(made))
          },
        },
        { label: "Rename", onSelect: () => startRenaming(rowKey.folder(path)) },
      ],
      isDesktop ? [{ label: "Show in Finder", onSelect: () => reveal(path) }] : [],
      [{ label: "Delete", destructive: true, onSelect: () => deleteFolder(path) }],
    ]
  }

  const pickedGroups = (keys: string[]): MenuGroups => {
    const { count } = topLevel(keys)
    return [[{ label: count === 1 ? "Delete" : `Delete ${count} items`, destructive: true, onSelect: () => deleteKeys(keys) }]]
  }

  return { fileGroups, folderGroups, pickedGroups, deleteKeys, startRenaming }
}
