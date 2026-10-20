import { t } from "@lingui/core/macro"
import { useCallback, useRef, useState } from "react"
import { LARGE_FILE_BYTES, paperUri, type AttachmentFile, type Connector, type FileKind } from "@owlit/protocol"
import { bridge, hasCore, rpc, RpcError } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { useWorkspace } from "@/lib/workspace"
import { docMentionable, paperMentionable, type DocMention } from "@/features/docs/lib/mentions"
import { fileAt } from "@/features/docs/store"
import { citationLabel } from "@/features/library/lib/format"
import { displayName, docUri, parentPath } from "@/features/docs/types"
import { addPaperFrom, sayAdded, usePaperActions } from "@/features/library/actions"
import { useLibraryStore } from "@/features/library/store"
import { NO_FILES, useComposerDrafts } from "../composer-drafts"

// A file as a chip shows it: sent with a message, or on its way into one, being copied or refused (a
// folder, a file that can't be read). Refused ones stay as chips that say why, and are never sent.
export interface ChipFile extends AttachmentFile {
  state?: "adding" | "ready" | "error"
  error?: string
  folder?: boolean
}

// A file in the composer, before it is sent
export interface DraftFile extends ChipFile {
  state: "adding" | "ready" | "error"
}

// The agent the message goes to, when it can't read some kinds of file (Connector.cannotRead)
export interface Reader {
  name: string
  cannotRead: FileKind[]
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// An agent as a chip names it: "Owlit engine (Beta)" is the Owlit engine there
export const agentName = (name: string) => name.replace(/\s*\([^)]*\)$/, "")

// The agent as the chips warn about it, when there are files it can't read
export const readerOf = (connector?: Connector): Reader | undefined =>
  connector?.cannotRead?.length ? { name: agentName(connector.name), cannotRead: connector.cannotRead } : undefined

// An attached file's copy, opened in the system's app for it
export function openAttached(file: { path?: string }) {
  if (!hasCore || !file.path) return
  rpc.chats.openFile({ path: file.path }).catch(toastError)
}

// The files a composer is attaching to a message of `chatId` (a chat that may not exist yet: a new chat's
// composer names the id it will start it with), kept with the draft `key` so they wait with it. Each is
// copied into the workspace as soon as it is attached, so sending never waits on a copy; one owlit already
// has turns into a mention instead, through `onMention`, told which draft it belongs to, since the copy
// may finish after the person has moved to another chat. Files over LARGE_FILE_BYTES wait in `large` for a
// yes (LargeFilesDialog) before anything is copied.
export function useAttachments(key: string, chatId: string, onMention: (mention: DocMention, key: string) => void) {
  const { open } = usePaperActions()
  const files = useComposerDrafts((s) => s.drafts[key]?.files ?? NO_FILES)
  const [large, setLarge] = useState<File[] | null>(null)
  const mentionRef = useRef(onMention)
  mentionRef.current = onMention
  const keyRef = useRef(key)
  keyRef.current = key
  const chatRef = useRef(chatId)
  chatRef.current = chatId
  const filesRef = useRef(files)
  filesRef.current = files

  const patch = (key: string, id: string, next: Partial<DraftFile> | null) =>
    useComposerDrafts.getState().patchFiles(key, (list) => (next === null ? list.filter((f) => f.id !== id) : list.map((f) => (f.id === id ? { ...f, ...next } : f))))

  // Into the chat and draft it was attached for, whichever is on screen when it is done
  const copy = useCallback(async (file: File, draft: DraftFile, key: string, chatId: string) => {
    if (!hasCore) return patch(key, draft.id, { state: "ready" })
    try {
      const path = bridge?.pathForFile(file)
      const result = path
        ? await rpc.chats.attach({ chatId, path, mimeType: file.type })
        : await rpc.chats.attach({ chatId, name: file.name, mimeType: file.type, data: await base64(file) })
      if (result.kind === "file") return patch(key, draft.id, { ...result.file, id: draft.id, previewUrl: draft.previewUrl, state: "ready" })
      patch(key, draft.id, null)
      mentionRef.current(result.kind === "doc" ? docMention(result.path) : await paperMention(result.paperId, file.name), key)
    } catch (error) {
      const message = error instanceof Error ? error.message : t`owlit couldn't read that file.`
      // Core says a folder was refused in its data, the words being in the interface's language
      const folder = error instanceof RpcError && (error.data as { folder?: boolean } | undefined)?.folder === true
      patch(key, draft.id, { state: "error", error: message, folder: folder || draft.folder })
    }
  }, [])

  const start = useCallback(
    (list: File[], folders: File[] = []) => {
      const drafts = list.map((file) => ({ file, draft: draftOf(file) }))
      const refused = folders.map((file) => ({ ...draftOf(file), state: "error" as const, error: t`Folders can't be attached yet.`, folder: true }))
      const key = keyRef.current
      useComposerDrafts.getState().patchFiles(key, (f) => [...f, ...drafts.map((d) => d.draft), ...refused])
      for (const { file, draft } of drafts) void copy(file, draft, key, chatRef.current)
    },
    [copy],
  )

  // Files from the button, a paste or a drop. A drop says which of its items are folders.
  const add = useCallback(
    (list: File[], folders: File[] = []) => {
      if (!list.length && !folders.length) return
      if (list.some((f) => f.size > LARGE_FILE_BYTES)) {
        setLarge(list)
        if (folders.length) start([], folders)
        return
      }
      start(list, folders)
    },
    [start],
  )

  // The question about large files answered: copy them all, only the smaller ones dropped with them
  // ("skip"), or nothing (the dialog dismissed)
  const answerLarge = useCallback(
    (how: "copy" | "skip" | null) => {
      const list = large ?? []
      setLarge(null)
      const chosen = how === "copy" ? list : how === "skip" ? list.filter((f) => f.size <= LARGE_FILE_BYTES) : []
      if (chosen.length) start(chosen)
    },
    [large, start],
  )

  // A chip taken off before sending: its copy goes too
  const remove = useCallback((id: string) => {
    const gone = filesRef.current.find((f) => f.id === id)
    if (gone?.path && hasCore) void rpc.chats.detach({ chatId: chatRef.current, path: gone.path }).catch(() => undefined)
    patch(keyRef.current, id, null)
  }, [])

  // A PDF added to the Library from its chip is that paper from then on: a mention, not a file
  const addToLibrary = useCallback(
    async (id: string) => {
      const draft = filesRef.current.find((f) => f.id === id)
      if (!draft?.path) return
      const key = keyRef.current
      const paper = await importCopy(draft, open)
      if (!paper) return
      remove(id)
      mentionRef.current(await paperMention(paper.id, draft.name), key)
    },
    [remove, open],
  )

  // What goes with the message: the files that are ready. The list empties for the next one.
  const take = useCallback((): AttachmentFile[] => {
    const ready = filesRef.current.filter((f) => f.state === "ready").map(({ state: _s, error: _e, folder: _f, ...file }) => file)
    useComposerDrafts.getState().patchFiles(keyRef.current, () => [])
    return ready
  }, [])

  return { files, add, remove, take, addToLibrary, adding: files.some((f) => f.state === "adding"), large, answerLarge }
}

// Splits a drop into files and folders: a folder arrives as a File too, and only its entry tells
export function fromDrop(data: DataTransfer): { files: File[]; folders: File[] } {
  const files: File[] = []
  const folders: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue
    const file = item.getAsFile()
    if (!file) continue
    if (item.webkitGetAsEntry()?.isDirectory) folders.push(file)
    else files.push(file)
  }
  return { files, folders }
}

function draftOf(file: File): DraftFile {
  return {
    id: crypto.randomUUID(),
    name: file.name || t`Pasted file`,
    size: file.size,
    mimeType: file.type,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    state: "adding",
  }
}

async function base64(file: File): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(t`owlit couldn't read that file.`))
    reader.readAsDataURL(file)
  })
  return url.slice(url.indexOf(",") + 1)
}

function docMention(path: string): DocMention {
  const file = fileAt(path)
  const mention = file ? docMentionable(file) : { id: path, kind: "doc" as const, title: displayName(path), subtitle: parentPath(path) || undefined, uri: docUri(path) }
  return { ...mention, label: displayName(path) }
}

async function paperMention(id: string, fallback: string): Promise<DocMention> {
  const paper = useLibraryStore.getState().papers[id]
  // A paper owlit knows no authors of (a local PDF) goes by its title rather than "Unknown"
  if (paper) return { ...paperMentionable(paper), label: paper.authors.length ? citationLabel(paper) : paper.title }
  return { id, kind: "paper", title: fallback, uri: paperUri(id), label: fallback }
}

// Adds an attached PDF's copy to the Library; the paper, or null when it couldn't be read (said in a toast)
export async function importCopy(file: AttachmentFile, open: (id: string) => void) {
  const root = useWorkspace.getState().current?.path
  if (!file.path || !root) return null
  try {
    const added = await addPaperFrom({ file: `${root}/${file.path}` })
    sayAdded(added, open)
    return added.paper
  } catch (error) {
    toastError(error, t`Couldn't add that file.`)
    return null
  }
}
