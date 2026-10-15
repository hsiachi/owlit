import type { AgentNote, DocConflict, DocsChange, DocStat, NoteAnchor, WorkspaceFile } from "@owlit/protocol"
import { RpcErrorCode } from "@owlit/protocol"
import { t } from "@lingui/core/macro"
import { toast } from "sonner"
import { toastError } from "@/lib/toast"
import { isDesktop, onNotify, rpc, RpcError } from "@/lib/rpc"
import { countDown, countUp } from "@/lib/counts"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { createDiskFlag, createWorkspaceQueue } from "@/lib/write-queue"
import { openEditor, replaceInEditor } from "./editors"
import { freshDocIds, useDocsStore } from "./store"
import { baseName, displayName, isMarkdown, isWithin } from "./types"

// The Docs store's link to the files on disk. The store changes at once (the UI never waits for the
// disk); each change is then sent to core in order, one at a time. Each op names files by the path core
// last reported for them, so a name core had to make unique ("Notes 2") is followed rather than fought.
// When core answers with a path the store didn't predict, the store takes core's. A failure reloads the
// tree from disk, which is the truth. Changes made outside owlit come in from core's watcher and are
// applied the same way: to the store, and to an open editor as one change the user can undo.

// What core last said about each file this window has on disk, by id
const known = new Map<string, { path: string; modifiedAt: number }>()
// The text last read from or written to disk, so an unchanged text is never written again
const written = new Map<string, string>()
// Ops queued and not yet done, by id; a file's path is reconciled only once it has none left
let pending: Record<string, number> = {}
const queue = createWorkspaceQueue({ onError: failed })

export const onDisk = isDesktop

function enqueue(ids: string[], op: () => Promise<void>) {
  for (const id of ids) pending = countUp(pending, id)
  queue.enqueue(op, (sameWorkspace) => {
    for (const id of ids) pending = countDown(pending, id)
    if (sameWorkspace) reconcile(ids)
  })
}

// Files whose ops are all done take the path core gave them
function reconcile(ids: string[]) {
  const { files } = useDocsStore.getState()
  const moved: Record<string, WorkspaceFile> = {}
  for (const id of ids) {
    const disk = known.get(id)
    const file = files[id]
    if (!disk || !file || pending[id] || file.path === disk.path) continue
    moved[id] = { ...file, path: disk.path }
  }
  if (Object.keys(moved).length) useDocsStore.setState((s) => ({ files: { ...s.files, ...moved } }))
}

const remember = (stat: DocStat, content?: string) => {
  known.set(stat.id, { path: stat.path, modifiedAt: stat.modifiedAt })
  if (content !== undefined) written.set(stat.id, content)
}

async function failed(error: unknown) {
  toastError(error, t`Couldn't save the change.`)
  await load()
}

// ---- Reading ----

// Replaces the store with the workspace as it is on disk. New docs that were never written stay.
async function load() {
  const [listing, notes] = await Promise.all([rpc.docs.list(), rpc.notes.all()])
  const before = new Map(written)
  known.clear()
  written.clear()
  for (const file of listing.files) remember(file, file.content)
  fromDisk(() =>
    useDocsStore.setState((s) => {
      const unsaved = Object.values(s.files).filter((f) => freshDocIds.has(f.id) && !known.has(f.id))
      return {
        files: Object.fromEntries([...listing.files, ...unsaved].map((f) => [f.id, f])),
        folders: listing.folders,
        // The store keeps notes by file id, so they stay with a doc through renames
        notes: Object.fromEntries(listing.files.filter((f) => notes[f.path]).map((f) => [f.id, notes[f.path]])),
        loaded: true,
      }
    }),
  )
  // Open docs the user hasn't touched since they were read show the disk's text
  for (const file of listing.files) {
    const old = before.get(file.id)
    if (file.content !== undefined && old !== undefined && old !== file.content && editorShows(file.id, old)) {
      replaceInEditor(file.id, file.content, "external")
    }
  }
}

// ---- Changes made outside owlit ----

// Up while the store takes a change that came from disk. Renames that happen this way are someone
// else's (Finder, git), so links to the file in other docs are not rewritten for them.
const diskFlag = createDiskFlag()
export const isDiskChange = diskFlag.isOn
const fromDisk = diskFlag.apply

// Whether the open editor for a doc holds exactly this text (in "\n" lines, for a CRLF file); true when
// the doc isn't open
function editorShows(id: string, text: string) {
  const view = openEditor(id)
  if (!view) return true
  const shown = view.state.doc.toString()
  return shown === text || shown === text.replace(/\r\n/g, "\n")
}

async function applyChange(change: DocsChange) {
  if (change.reload) return load()
  const { files } = useDocsStore.getState()
  const byPath = new Map(Object.values(files).map((f) => [f.path, f.id]))
  const next = { ...files }
  const intoEditors: [string, string][] = []
  const conflicts: [string, DocConflict][] = []
  for (const file of change.changed) {
    const id = file.id && next[file.id] ? file.id : (byPath.get(file.path) ?? file.id)
    const mine = next[id]
    const disk = known.get(id)
    const content = file.content
    const changedText = content !== undefined && content !== written.get(id)
    // The user has typed since the doc was last read or saved: their text stays, and they choose
    const dirty = mine !== undefined && changedText && !editorShows(id, written.get(id) ?? mine.content ?? "")
    known.set(id, { path: file.path, modifiedAt: dirty && disk ? disk.modifiedAt : file.modifiedAt })
    if (dirty) {
      next[id] = { ...mine, path: file.path }
      conflicts.push([id, { path: file.path, content: content ?? "", modifiedAt: file.modifiedAt }])
      continue
    }
    if (content !== undefined) written.set(id, content)
    next[id] = mine ? { ...mine, path: file.path, content, modifiedAt: file.modifiedAt, nameLocked: file.nameLocked ?? mine.nameLocked } : { ...file, id }
    if (mine && changedText && content !== undefined && openEditor(id)) intoEditors.push([id, content])
  }
  const missing = { ...useDocsStore.getState().missing }
  for (const gone of change.deleted) {
    const id = gone.id && next[gone.id] ? gone.id : byPath.get(gone.path)
    if (!id) continue
    known.delete(id)
    written.delete(id)
    // An open doc stays on screen, read-only, until the user leaves it or saves it again
    if (openEditor(id)) {
      missing[id] = true
      deletedWhileOpen(id)
    } else delete next[id]
  }
  const goneFolders = change.folders.deleted
  const folders = [
    ...useDocsStore.getState().folders.filter((f) => !goneFolders.some((g) => isWithin(f, g))),
    ...change.folders.created,
  ]
  fromDisk(() => useDocsStore.setState({ files: next, folders: [...new Set(folders)], missing }))
  for (const [id, content] of intoEditors) replaceInEditor(id, content, "external")
  for (const [id, disk] of conflicts) conflicted(id, disk)
}

function deletedWhileOpen(id: string) {
  const file = useDocsStore.getState().files[id]
  if (!file) return
  const name = displayName(file.path)
  toast.warning(t`${name} was deleted outside owlit`, {
    id: `conflict-${id}`,
    description: t`It stays open here until you leave it.`,
    duration: Infinity,
    action: { label: t`Save again`, onClick: () => saveAgain(id) },
  })
}

// Writes a doc that vanished from disk back where it was, from the text owlit has
export function saveAgain(id: string) {
  toast.dismiss(`conflict-${id}`)
  known.delete(id)
  written.delete(id)
  const { missing } = useDocsStore.getState()
  if (missing[id]) {
    const rest = { ...missing }
    delete rest[id]
    useDocsStore.setState({ missing: rest })
  }
  saveDoc(id)
}

// A doc deleted on disk while it was open is let go once the user leaves it
export function leftMissingDoc(id: string) {
  const { missing, files } = useDocsStore.getState()
  if (!missing[id]) return
  toast.dismiss(`conflict-${id}`)
  const rest = { ...missing }
  delete rest[id]
  const others = { ...files }
  delete others[id]
  useDocsStore.setState({ missing: rest, files: others })
}

const reload = () => enqueue([], load)

// ---- Writing: called by the store's actions after they have changed the store ----

// Writes a doc's latest text; a new doc is created by its first character, never before. A doc not yet on
// disk is created where it was when this was asked, so later moves in the queue find it there.
export function saveDoc(id: string) {
  const asked = useDocsStore.getState().files[id]
  if (!asked) return
  const at = { path: asked.path, followsFirstLine: !asked.nameLocked }
  enqueue([id], async () => {
    const { files, missing } = useDocsStore.getState()
    const file = files[id]
    // A doc deleted on disk comes back only when the user saves it again
    if (!file || missing[id] || file.content === undefined || written.get(id) === file.content) return
    const content = file.content
    const disk = known.get(id)
    if (!disk) {
      if (!content) return
      remember(await rpc.docs.create({ ...at, content, id }), content)
      return
    }
    try {
      remember(await rpc.docs.write({ path: disk.path, content, expectedModifiedAt: disk.modifiedAt }), content)
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.Conflict) return conflicted(id, error.data as DocConflict)
      throw error
    }
  })
}

export function renameOnDisk(id: string, name: string) {
  enqueue([id], async () => {
    const disk = known.get(id)
    if (disk) known.set(id, { ...disk, path: (await rpc.docs.rename({ path: disk.path, name })).path })
  })
}

export function moveOnDisk(id: string, folder: string) {
  enqueue([id], async () => {
    const disk = known.get(id)
    if (disk) known.set(id, { ...disk, path: (await rpc.docs.move({ path: disk.path, folder })).path })
  })
}

export function deleteOnDisk(id: string) {
  enqueue([id], async () => {
    const disk = known.get(id)
    if (!disk) return
    known.delete(id)
    written.delete(id)
    await rpc.docs.delete({ path: disk.path })
  })
}

export function createFolderOnDisk(path: string) {
  enqueue([], async () => {
    if ((await rpc.docs.createFolder({ path })).path !== path) await load()
  })
}

const idsWithin = (folder: string) => Object.values(useDocsStore.getState().files).filter((f) => isWithin(f.path, folder)).map((f) => f.id)

// Renames or moves a folder; everything known under it follows core's answer
function relocateFolder(from: string, to: string, change: () => Promise<{ path: string }>) {
  enqueue(idsWithin(to), async () => {
    const at = (await change()).path
    for (const [id, disk] of known) if (isWithin(disk.path, from)) known.set(id, { ...disk, path: at + disk.path.slice(from.length) })
    if (at !== to) await load()
  })
}

export const renameFolderOnDisk = (from: string, to: string) => relocateFolder(from, to, () => rpc.docs.rename({ path: from, name: baseName(to) }))

export const moveFolderOnDisk = (from: string, to: string, parent: string) => relocateFolder(from, to, () => rpc.docs.move({ path: from, folder: parent }))

export function deleteFolderOnDisk(path: string) {
  enqueue([], async () => {
    for (const [id, disk] of known) if (isWithin(disk.path, path)) known.delete(id)
    await rpc.docs.delete({ path })
  })
}

// Undo of a delete: Markdown files come back from the text the store kept; other files stay in the Trash
export function restoreOnDisk(files: WorkspaceFile[], folders: string[]) {
  const docs = files.filter((f) => isMarkdown(f.path) && f.content !== undefined)
  enqueue(
    docs.map((f) => f.id),
    async () => {
      const result = await rpc.docs.restore({ files: docs.map((f) => ({ id: f.id, path: f.path, content: f.content ?? "" })), folders })
      for (const stat of result.files) remember(stat, docs.find((f) => f.id === stat.id)?.content)
    },
  )
}

// ---- Agents' notes, beside the file they belong to ----

// Where a doc's notes live: by its path on disk, or where it will be written if it isn't yet
const notesPath = (id: string) => known.get(id)?.path ?? useDocsStore.getState().files[id]?.path

export function addNoteOnDisk(id: string, note: AgentNote) {
  enqueue([id], async () => {
    const path = notesPath(id)
    if (path) await rpc.notes.add({ path, note })
  })
}

export function removeNoteOnDisk(id: string, noteId: string) {
  enqueue([id], async () => {
    const path = notesPath(id)
    if (path) await rpc.notes.remove({ path, id: noteId })
  })
}

export function reanchorOnDisk(id: string, moved: Record<string, NoteAnchor>) {
  enqueue([id], async () => {
    const path = notesPath(id)
    if (path) await rpc.notes.reanchor({ path, moved })
  })
}

export function openOnDisk(path: string) {
  rpc.docs.open({ path }).catch(toastError)
}

// ---- When the disk disagrees ----

// The file changed on disk since this window last saw it: the user's text isn't saved, and they choose.
// Reload takes the disk's text (one change in the editor, so ⌘Z brings theirs back); Keep mine writes
// theirs over it.
function conflicted(id: string, disk: DocConflict) {
  const file = useDocsStore.getState().files[id]
  if (!file) return
  const name = displayName(file.path)
  if (disk.content === null) {
    toast.warning(t`${name} is no longer on disk`, {
      id: `conflict-${id}`,
      description: t`It was moved or deleted outside owlit.`,
      duration: Infinity,
      action: { label: t`Save again`, onClick: () => saveAgain(id) },
    })
    return
  }
  const theirs = { content: disk.content, modifiedAt: disk.modifiedAt ?? 0 }
  toast.warning(t`${name} changed on disk`, {
    id: `conflict-${id}`,
    description: t`Your latest edits aren't saved yet.`,
    duration: Infinity,
    action: {
      label: t({ message: "Reload", comment: "take the text on disk instead of the unsaved edits" }),
      onClick: () =>
        enqueue([id], async () => {
          const at = known.get(id)
          if (!at) return
          known.set(id, { ...at, modifiedAt: theirs.modifiedAt })
          written.set(id, theirs.content)
          replaceInEditor(id, theirs.content, "external")
          useDocsStore.setState((s) => ({ files: { ...s.files, [id]: { ...s.files[id], content: theirs.content } } }))
        }),
    },
    cancel: {
      label: t`Keep mine`,
      onClick: () =>
        enqueue([id], async () => {
          const at = known.get(id)
          const content = useDocsStore.getState().files[id]?.content
          if (!at || content === undefined) return
          remember(await rpc.docs.write({ path: at.path, content, expectedModifiedAt: at.modifiedAt, force: true }), content)
        }),
    },
  })
}

// ---- Workspace ----

if (onDisk) {
  onWorkspaceOpened(() => {
    queue.reset()
    known.clear()
    written.clear()
    pending = {}
    freshDocIds.clear()
    useDocsStore.setState({ files: {}, folders: [], notes: {}, missing: {}, loaded: false })
    reload()
  })
  onNotify("docs.changed", (change) => enqueue([], () => applyChange(change)))
  // Opened before this module was loaded (a reload of the window)
  queueMicrotask(() => {
    if (useWorkspace.getState().current && !useDocsStore.getState().loaded) reload()
  })
}
