import type { DocConflict, DocStat, WorkspaceFile } from "@owlit/protocol"
import { RpcErrorCode } from "@owlit/protocol"
import { toast } from "sonner"
import { isDesktop, rpc, RpcError } from "@/lib/rpc"
import { onWorkspaceOpened, useWorkspace } from "@/lib/workspace"
import { replaceInEditor } from "./editors"
import { freshDocIds, useDocsStore } from "./store"
import { baseName, displayName, isMarkdown, isWithin } from "./types"

// The Docs store's link to the files on disk. The store changes at once (the UI never waits for the
// disk); each change is then sent to core in order, one at a time. Each op names files by the path core
// last reported for them, so a name core had to make unique ("Notes 2") is followed rather than fought.
// When core answers with a path the store didn't predict, the store takes core's. A failure reloads the
// tree from disk, which is the truth.

// What core last said about each file this window has on disk, by id
const known = new Map<string, { path: string; modifiedAt: number }>()
// The text last read from or written to disk, so an unchanged text is never written again
const written = new Map<string, string>()
// Ops queued and not yet done, by id; a file's path is reconciled only once it has none left
const pending = new Map<string, number>()
let chain: Promise<void> = Promise.resolve()
// Bumped when another workspace opens, so ops queued for the old one are dropped
let generation = 0

export const onDisk = isDesktop

function enqueue(ids: string[], op: () => Promise<void>) {
  const gen = generation
  for (const id of ids) pending.set(id, (pending.get(id) ?? 0) + 1)
  chain = chain.then(async () => {
    try {
      if (gen === generation) await op()
    } catch (error) {
      if (gen === generation) await failed(error)
    } finally {
      for (const id of ids) {
        const left = (pending.get(id) ?? 1) - 1
        if (left) pending.set(id, left)
        else pending.delete(id)
      }
      if (gen === generation) reconcile(ids)
    }
  })
}

// Files whose ops are all done take the path core gave them
function reconcile(ids: string[]) {
  const { files } = useDocsStore.getState()
  const moved: Record<string, WorkspaceFile> = {}
  for (const id of ids) {
    const disk = known.get(id)
    const file = files[id]
    if (!disk || !file || pending.has(id) || file.path === disk.path) continue
    moved[id] = { ...file, path: disk.path }
  }
  if (Object.keys(moved).length) useDocsStore.setState((s) => ({ files: { ...s.files, ...moved } }))
}

const remember = (stat: DocStat, content?: string) => {
  known.set(stat.id, { path: stat.path, modifiedAt: stat.modifiedAt })
  if (content !== undefined) written.set(stat.id, content)
}

async function failed(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Couldn't save the change.")
  await load()
}

// ---- Reading ----

// Replaces the store with the workspace as it is on disk. New docs that were never written stay.
async function load() {
  const listing = await rpc.docs.list()
  known.clear()
  written.clear()
  for (const file of listing.files) remember(file, file.content)
  useDocsStore.setState((s) => {
    const unsaved = Object.values(s.files).filter((f) => freshDocIds.has(f.id) && !known.has(f.id))
    return {
      files: Object.fromEntries([...listing.files, ...unsaved].map((f) => [f.id, f])),
      folders: listing.folders,
      loaded: true,
    }
  })
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
    const file = useDocsStore.getState().files[id]
    if (!file || file.content === undefined || written.get(id) === file.content) return
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

export function openOnDisk(path: string) {
  rpc.docs.open({ path }).catch((error: Error) => toast.error(error.message))
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
    toast.warning(`${name} is no longer on disk`, {
      id: `conflict-${id}`,
      description: "It was moved or deleted outside owlit.",
      duration: Infinity,
      action: {
        label: "Save again",
        onClick: () => {
          known.delete(id)
          written.delete(id)
          saveDoc(id)
        },
      },
    })
    return
  }
  const theirs = { content: disk.content, modifiedAt: disk.modifiedAt ?? 0 }
  toast.warning(`${name} changed on disk`, {
    id: `conflict-${id}`,
    description: "Your latest edits aren't saved yet.",
    duration: Infinity,
    action: {
      label: "Reload",
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
      label: "Keep mine",
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
    generation++
    known.clear()
    written.clear()
    pending.clear()
    freshDocIds.clear()
    useDocsStore.setState({ files: {}, folders: [], notes: {}, loaded: false })
    reload()
  })
  // Opened before this module was loaded (a reload of the window)
  queueMicrotask(() => {
    if (useWorkspace.getState().current && !useDocsStore.getState().loaded) reload()
  })
}
