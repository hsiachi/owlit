import { create } from "zustand"
import { persist } from "zustand/middleware"
import { cleanName, extOf, nameFromFirstLine, timeName, uniquePath } from "./lib/naming"
import { seedFiles, seedFolders, seedNotes } from "./mocks/seed"
import { baseName, isMarkdown, joinPath, parentPath, type AgentNote, type WorkspaceFile } from "./types"

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)

// Docs started in this session. One left without a single character is discarded when the user moves
// on, so a stray ⌘N leaves nothing behind; files that were already on disk are never touched this way.
export const freshDocIds = new Set<string>()

const within = (path: string, folder: string) => path === folder || path.startsWith(folder + "/")

// Everything a folder deletion removed, so it can be put back
export interface Removed {
  files: WorkspaceFile[]
  folders: string[]
}

interface DocsState {
  files: Record<string, WorkspaceFile>
  // Folders the user made; folders that hold files exist anyway. Kept so empty folders survive.
  folders: string[]

  createDoc: (folder: string) => WorkspaceFile
  // A doc written whole at a chosen path (an agent creating a file); null if the path is taken
  createDocAt: (path: string, content: string) => WorkspaceFile | null
  // Saves the text; while the file was never renamed by hand, its name follows the first line
  writeDoc: (id: string, content: string) => void
  renameFile: (id: string, name: string) => void
  moveFile: (id: string, folder: string) => void
  deleteFile: (id: string) => Removed
  createFolder: (parent: string) => string
  renameFolder: (path: string, name: string) => string
  moveFolder: (path: string, parent: string) => string
  deleteFolder: (path: string) => Removed
  restore: (removed: Removed) => void

  // Agents' notes, by file id, so a note stays with its doc through renames and moves
  notes: Record<string, AgentNote[]>
  addNote: (fileId: string, note: AgentNote) => void
  removeNote: (fileId: string, noteId: string) => AgentNote | undefined
  restoreNote: (fileId: string, note: AgentNote) => void
}

function pathTaken(files: Record<string, WorkspaceFile>, folders: string[], selfId?: string) {
  const lower = (p: string) => p.toLowerCase()
  return (path: string) =>
    Object.values(files).some((f) => f.id !== selfId && lower(f.path) === lower(path)) || folders.some((f) => lower(f) === lower(path))
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
  persist(
    (set, get) => ({
      files: Object.fromEntries(seedFiles.map((f) => [f.id, f])),
      folders: seedFolders,
      notes: seedNotes,

      createDoc: (folder) => {
        const t = Date.now()
        const { files, folders } = get()
        const path = uniquePath(folder, timeName(t), ".md", pathTaken(files, folders))
        const file: WorkspaceFile = { id: newId(), path, content: "", createdAt: t, modifiedAt: t }
        set((s) => ({ files: { ...s.files, [file.id]: file } }))
        freshDocIds.add(file.id)
        return file
      },

      createDocAt: (path, content) => {
        const { files, folders } = get()
        if (!isMarkdown(path) || pathTaken(files, folders)(path)) return null
        const t = Date.now()
        const file: WorkspaceFile = { id: newId(), path, content, createdAt: t, modifiedAt: t, nameLocked: true }
        set((s) => ({ files: { ...s.files, [file.id]: file } }))
        return file
      },

      writeDoc: (id, content) =>
        set((s) => {
          const f = s.files[id]
          if (!f || f.content === content) return s
          let path = f.path
          if (!f.nameLocked) {
            const stem = nameFromFirstLine(content) || timeName(f.createdAt)
            const folder = parentPath(f.path)
            const taken = pathTaken(s.files, s.folders, id)
            const current = baseName(f.path).slice(0, -3)
            // A doc already numbered because its name is taken ("Notes 2") keeps its number
            const numbered = current.startsWith(stem + " ") && /^\d+$/.test(current.slice(stem.length + 1)) && taken(joinPath(folder, stem + ".md"))
            if (stem !== current && !numbered) path = uniquePath(folder, stem, ".md", taken)
          }
          return { files: { ...s.files, [id]: { ...f, content, path, modifiedAt: Date.now() } } }
        }),

      renameFile: (id, name) =>
        set((s) => {
          const f = s.files[id]
          const stem = cleanName(name.replace(/\.md$/i, ""))
          if (!f || !stem) return s
          const path = uniquePath(parentPath(f.path), stem, extOf(f.path), pathTaken(s.files, s.folders, id))
          return { files: { ...s.files, [id]: { ...f, path, nameLocked: isMarkdown(f.path) ? true : f.nameLocked } } }
        }),

      moveFile: (id, folder) =>
        set((s) => {
          const f = s.files[id]
          if (!f || parentPath(f.path) === folder) return s
          const name = baseName(f.path)
          const ext = extOf(name)
          const path = uniquePath(folder, ext ? name.slice(0, -ext.length) : name, ext, pathTaken(s.files, s.folders, id))
          return { files: { ...s.files, [id]: { ...f, path } } }
        }),

      deleteFile: (id) => {
        const f = get().files[id]
        if (!f) return { files: [], folders: [] }
        set((s) => {
          const files = { ...s.files }
          delete files[id]
          return { files }
        })
        return { files: [f], folders: [] }
      },

      createFolder: (parent) => {
        const { files, folders } = get()
        const path = uniquePath(parent, "New folder", "", pathTaken(files, folders))
        set((s) => ({ folders: [...s.folders, path] }))
        return path
      },

      renameFolder: (path, name) => {
        const clean = cleanName(name)
        if (!clean || clean === baseName(path)) return path
        const s = get()
        const to = uniquePath(parentPath(path), clean, "", pathTaken(s.files, s.folders))
        set(relocate(s, path, to))
        return to
      },

      moveFolder: (path, parent) => {
        // A folder can't go inside itself
        if (parentPath(path) === parent || within(parent, path)) return path
        const s = get()
        const to = uniquePath(parent, baseName(path), "", pathTaken(s.files, s.folders))
        set(relocate(s, path, to))
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
        return removed
      },

      addNote: (fileId, note) => set((s) => ({ notes: { ...s.notes, [fileId]: [...(s.notes[fileId] ?? []), note] } })),

      removeNote: (fileId, noteId) => {
        const note = get().notes[fileId]?.find((n) => n.id === noteId)
        set((s) => ({ notes: { ...s.notes, [fileId]: (s.notes[fileId] ?? []).filter((n) => n.id !== noteId) } }))
        return note
      },

      restoreNote: (fileId, note) =>
        set((s) => ({ notes: { ...s.notes, [fileId]: [...(s.notes[fileId] ?? []).filter((n) => n.id !== note.id), note].sort((a, b) => a.createdAt - b.createdAt) } })),

      restore: ({ files, folders }) =>
        set((s) => ({
          files: { ...s.files, ...Object.fromEntries(files.map((f) => [f.id, f])) },
          folders: [...s.folders, ...folders.filter((f) => !s.folders.includes(f))],
        })),
    }),
    {
      name: "owlit-docs",
      version: 1,
      // Stores saved before notes existed get the seed notes for docs they still have
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DocsState>
        return { ...current, ...p, notes: p.notes ?? Object.fromEntries(Object.entries(current.notes).filter(([id]) => (p.files ?? current.files)[id])) }
      },
    },
  ),
)

export const folderOf = (file: WorkspaceFile) => parentPath(file.path)
