import { t } from "@lingui/core/macro"
import { create } from "zustand"
import { newId } from "@/lib/id"
import * as disk from "./disk"
import { cleanName, extOf, followFirstLine, timeName, uniquePath } from "./lib/naming"
import { baseName, isMarkdown, isWithin as within, joinPath, parentPath, type CommentAnchor, type DocComment, type WorkspaceFile } from "./types"

// The store mirrors the workspace's files: core lists them when a workspace opens, and every action below
// changes the store at once and then the disk (./disk).

// Docs started in this session. One left without a single character is discarded when the user moves
// on, so a stray ⌘N leaves nothing behind; files that were already on disk are never touched this way.
export const freshDocIds = new Set<string>()

// Everything a folder deletion removed, so it can be put back
export interface Removed {
  files: WorkspaceFile[]
  folders: string[]
}

interface DocsState {
  // Whether the workspace's files have been listed; until then an unknown doc id may still turn up
  loaded: boolean
  files: Record<string, WorkspaceFile>
  // Open docs deleted on disk by something else; they stay on screen, read-only, until left
  missing: Record<string, true>
  // Folders the user made; folders that hold files exist anyway. Kept so empty folders survive.
  folders: string[]

  createDoc: (folder: string) => WorkspaceFile
  // A doc written whole at a chosen path (an agent creating a file); null if the path is taken
  createDocAt: (path: string, content: string) => WorkspaceFile | null
  // A copy beside a Markdown doc, named "Name copy", holding the given text (the doc as it reads now)
  duplicateDoc: (id: string, content: string) => WorkspaceFile | null
  // Saves the text; while the file was never renamed by hand, its name follows the first line. `keepTime`
  // leaves the edit time alone, for changes the user didn't make (links following a renamed doc).
  writeDoc: (id: string, content: string, keepTime?: boolean) => void
  renameFile: (id: string, name: string) => void
  moveFile: (id: string, folder: string) => void
  deleteFile: (id: string) => Removed
  createFolder: (parent: string) => string
  renameFolder: (path: string, name: string) => string
  moveFolder: (path: string, parent: string) => string
  deleteFolder: (path: string) => Removed
  restore: (removed: Removed) => void

  // Comments on docs (Owlit's and yours; readers' are in the share store), by file id, so a comment stays
  // with its doc through renames and moves. Resolved ones are kept too.
  comments: Record<string, DocComment[]>
  // Starts a comment, or puts one back (Undo of a delete)
  addComment: (fileId: string, comment: DocComment) => void
  // Replaces a comment as it reads now (a reply, an edit, resolved); the comment as it was
  putComment: (fileId: string, comment: DocComment) => DocComment | undefined
  removeComment: (fileId: string, commentId: string) => DocComment | undefined
  // Comments whose passage was edited keep finding it: their quote and context become the text as it is now
  reanchorComments: (fileId: string, moved: Record<string, CommentAnchor>) => void
}

// A path is taken by a file, a folder the user made, or a folder that exists because it holds files
export function pathTaken(files: Record<string, WorkspaceFile>, folders: string[], selfId?: string) {
  const lower = (p: string) => p.toLowerCase()
  return (path: string) =>
    Object.values(files).some((f) => f.id !== selfId && (lower(f.path) === lower(path) || lower(f.path).startsWith(lower(path) + "/"))) ||
    folders.some((f) => lower(f) === lower(path))
}

// Rewrites every path under `from` to sit under `to` instead
function relocate(state: Pick<DocsState, "files" | "folders">, from: string, to: string) {
  const swap = (p: string) => (within(p, from) ? to + p.slice(from.length) : p)
  const files = Object.fromEntries(Object.values(state.files).map((f) => [f.id, within(f.path, from) ? { ...f, path: swap(f.path) } : f]))
  const folders = state.folders.map(swap)
  if (!folders.includes(to)) folders.push(to)
  return { files, folders }
}

export const useDocsStore = create<DocsState>()(
    (set, get) => ({
      loaded: false,
      files: {},
      missing: {},
      folders: [],
      comments: {},

      createDoc: (folder) => {
        const now = Date.now()
        const { files, folders } = get()
        const path = uniquePath(folder, timeName(now), ".md", pathTaken(files, folders))
        const file: WorkspaceFile = { id: newId(), path, content: "", createdAt: now, modifiedAt: now }
        set((s) => ({ files: { ...s.files, [file.id]: file } }))
        freshDocIds.add(file.id)
        return file
      },

      createDocAt: (path, content) => {
        const { files, folders } = get()
        if (!isMarkdown(path) || pathTaken(files, folders)(path)) return null
        const now = Date.now()
        const file: WorkspaceFile = { id: newId(), path, content, createdAt: now, modifiedAt: now, nameLocked: true }
        set((s) => ({ files: { ...s.files, [file.id]: file } }))
        if (disk.onDisk) disk.saveDoc(file.id)
        return file
      },

      duplicateDoc: (id, content) => {
        const s = get()
        const f = s.files[id]
        if (!f || !isMarkdown(f.path)) return null
        const ext = extOf(f.path)
        const stem = baseName(f.path).slice(0, -ext.length || undefined)
        // The copy's file name is in the interface language; nothing matches on it
        const name = t({ message: `${stem} copy`, comment: "file name of a duplicated doc: the original name, then copy" })
        return get().createDocAt(uniquePath(parentPath(f.path), name, ext, pathTaken(s.files, s.folders)), content)
      },

      writeDoc: (id, content, keepTime) => {
        const f = get().files[id]
        if (!f || f.content === content) return
        // Core names the file on disk the same way; the store predicts it so the tree doesn't wait
        const path = f.nameLocked ? f.path : (followFirstLine(f.path, content, f.createdAt, pathTaken(get().files, get().folders, id)) ?? f.path)
        set((s) => ({ files: { ...s.files, [id]: { ...f, content, path, modifiedAt: keepTime ? f.modifiedAt : Date.now() } } }))
        if (disk.onDisk) disk.saveDoc(id)
      },

      renameFile: (id, name) => {
        const s = get()
        const f = s.files[id]
        const stem = cleanName(name.replace(/\.md$/i, ""))
        if (!f || !stem) return
        const path = uniquePath(parentPath(f.path), stem, extOf(f.path), pathTaken(s.files, s.folders, id))
        set({ files: { ...s.files, [id]: { ...f, path, nameLocked: isMarkdown(f.path) ? true : f.nameLocked } } })
        if (disk.onDisk) disk.renameOnDisk(id, baseName(path))
      },

      moveFile: (id, folder) => {
        const s = get()
        const f = s.files[id]
        if (!f || parentPath(f.path) === folder) return
        const name = baseName(f.path)
        const ext = extOf(name)
        const path = uniquePath(folder, ext ? name.slice(0, -ext.length) : name, ext, pathTaken(s.files, s.folders, id))
        set({ files: { ...s.files, [id]: { ...f, path } } })
        if (disk.onDisk) disk.moveOnDisk(id, folder)
      },

      deleteFile: (id) => {
        const f = get().files[id]
        if (!f) return { files: [], folders: [] }
        set((s) => {
          const files = { ...s.files }
          delete files[id]
          return { files }
        })
        if (disk.onDisk) disk.deleteOnDisk(id)
        return { files: [f], folders: [] }
      },

      createFolder: (parent) => {
        const { files, folders } = get()
        const path = uniquePath(parent, t`New folder`, "", pathTaken(files, folders))
        set((s) => ({ folders: [...s.folders, path] }))
        if (disk.onDisk) disk.createFolderOnDisk(path)
        return path
      },

      renameFolder: (path, name) => {
        const clean = cleanName(name)
        if (!clean || clean === baseName(path)) return path
        const s = get()
        // A change of case only is the same folder, so it can't collide with itself
        const to = clean.toLowerCase() === baseName(path).toLowerCase() ? joinPath(parentPath(path), clean) : uniquePath(parentPath(path), clean, "", pathTaken(s.files, s.folders))
        set(relocate(s, path, to))
        if (disk.onDisk) disk.renameFolderOnDisk(path, to)
        return to
      },

      moveFolder: (path, parent) => {
        // A folder can't go inside itself
        if (parentPath(path) === parent || within(parent, path)) return path
        const s = get()
        const to = uniquePath(parent, baseName(path), "", pathTaken(s.files, s.folders))
        set(relocate(s, path, to))
        if (disk.onDisk) disk.moveFolderOnDisk(path, to, parent)
        return to
      },

      deleteFolder: (path) => {
        const s = get()
        const removed: Removed = {
          files: Object.values(s.files).filter((f) => within(f.path, path)),
          folders: s.folders.filter((f) => within(f, path)),
        }
        set({
          files: Object.fromEntries(Object.values(s.files).filter((f) => !within(f.path, path)).map((f) => [f.id, f])),
          folders: s.folders.filter((f) => !within(f, path)),
        })
        if (disk.onDisk) disk.deleteFolderOnDisk(path)
        return removed
      },

      addComment: (fileId, comment) => {
        set((s) => ({ comments: { ...s.comments, [fileId]: [...(s.comments[fileId] ?? []).filter((c) => c.id !== comment.id), comment].sort((a, b) => a.createdAt - b.createdAt) } }))
        if (disk.onDisk) disk.addCommentOnDisk(fileId, comment)
      },

      putComment: (fileId, comment) => {
        const before = get().comments[fileId]?.find((c) => c.id === comment.id)
        if (!before) return void get().addComment(fileId, comment)
        set((s) => ({ comments: { ...s.comments, [fileId]: (s.comments[fileId] ?? []).map((c) => (c.id === comment.id ? comment : c)) } }))
        if (disk.onDisk) disk.putCommentOnDisk(fileId, comment)
        return before
      },

      removeComment: (fileId, commentId) => {
        const comment = get().comments[fileId]?.find((c) => c.id === commentId)
        set((s) => ({ comments: { ...s.comments, [fileId]: (s.comments[fileId] ?? []).filter((c) => c.id !== commentId) } }))
        if (comment && disk.onDisk) disk.removeCommentOnDisk(fileId, commentId)
        return comment
      },

      reanchorComments: (fileId, moved) => {
        set((s) => ({ comments: { ...s.comments, [fileId]: (s.comments[fileId] ?? []).map((c) => (moved[c.id] ? { ...c, ...moved[c.id] } : c)) } }))
        if (disk.onDisk) disk.reanchorOnDisk(fileId, moved)
      },

      // Undo of a delete. On disk only Markdown comes back (from the text kept here); other files
      // stay in the system Trash, so they aren't put back in the tree either.
      restore: ({ files, folders }) => {
        const back = disk.onDisk ? files.filter((f) => isMarkdown(f.path) && f.content !== undefined) : files
        set((s) => ({
          files: { ...s.files, ...Object.fromEntries(back.map((f) => [f.id, f])) },
          folders: [...s.folders, ...folders.filter((f) => !s.folders.includes(f))],
        }))
        if (disk.onDisk) disk.restoreOnDisk(back, folders)
      },
    }),
)

// Something derived from the files, built once per change to them rather than on every lookup
export function perFiles<T>(build: (files: Record<string, WorkspaceFile>) => T) {
  const cache = new WeakMap<Record<string, WorkspaceFile>, T>()
  return (files: Record<string, WorkspaceFile>) => {
    let value = cache.get(files)
    if (value === undefined) cache.set(files, (value = build(files)))
    return value
  }
}

// The files by their workspace path
export const filesByPath = perFiles((files) => new Map(Object.values(files).map((f) => [f.path, f])))

// The file at a workspace path, if the workspace has one
export const fileAt = (path: string) => filesByPath(useDocsStore.getState().files).get(path)
