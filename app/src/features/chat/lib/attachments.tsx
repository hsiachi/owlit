import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { LARGE_FILE_BYTES, paperUri, type AttachmentFile, type Mentionable } from "@owlit/protocol"
import { BorderedList } from "@/components/bordered-list"
import { DialogHeading } from "@/components/info"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { bridge, isDesktop, rpc } from "@/lib/rpc"
import { useWorkspace } from "@/lib/workspace"
import { docMentionable, paperMentionable } from "@/features/docs/lib/mentions"
import { fileAt } from "@/features/docs/store"
import { citationLabel } from "@/features/library/lib/format"
import { displayName, docUri, parentPath } from "@/features/docs/types"
import { importPdf } from "@/features/library/disk"
import { useLibraryStore } from "@/features/library/store"
import { formatBytes } from "../components/composer/AttachmentList"

// A file on its way into a message: being copied, ready to send, or refused (a folder, a file that can't
// be read). Refused ones stay as chips that say why, and are never sent.
export interface DraftFile extends AttachmentFile {
  state: "adding" | "ready" | "error"
  error?: string
  folder?: boolean
}

// What became of a file that owlit already had: the doc or paper it is, mentioned like an @ pick
export interface AttachedMention extends Mentionable {
  label: string
}

const ABOUT_COPIES = "owlit keeps a copy of each file you attach with the chat, inside the workspace, so the chat still has it when the original moves or changes."

// The files a composer is attaching to a message of `chatId` (a chat that may not exist yet: a new chat's
// composer names the id it will start it with). Each is copied into the workspace as soon as it is
// attached (PRODUCT.md §4, Files in chat); one owlit already has turns into a mention instead, through
// `onMention`.
export function useAttachments(chatId: string, onMention: (mention: AttachedMention) => void) {
  const [files, setFiles] = useState<DraftFile[]>([])
  // Files over LARGE_FILE_BYTES wait for a yes before anything is copied
  const [asking, setAsking] = useState<File[] | null>(null)
  const mentionRef = useRef(onMention)
  mentionRef.current = onMention
  const chatRef = useRef(chatId)
  const filesRef = useRef(files)
  filesRef.current = files

  const patch = (id: string, next: Partial<DraftFile> | null) =>
    setFiles((list) => (next === null ? list.filter((f) => f.id !== id) : list.map((f) => (f.id === id ? { ...f, ...next } : f))))

  const copy = useCallback(async (file: File, draft: DraftFile) => {
    if (!isDesktop) return patch(draft.id, { state: "ready" })
    try {
      const path = bridge?.pathForFile(file)
      const result = path
        ? await rpc.chats.attach({ chatId: chatRef.current, path, mimeType: file.type })
        : await rpc.chats.attach({ chatId: chatRef.current, name: file.name, mimeType: file.type, data: await base64(file) })
      if (result.kind === "file") return patch(draft.id, { ...result.file, id: draft.id, previewUrl: draft.previewUrl, state: "ready" })
      patch(draft.id, null)
      mentionRef.current(result.kind === "doc" ? docMention(result.path) : await paperMention(result.paperId, file.name))
    } catch (error) {
      const message = error instanceof Error ? error.message : "owlit couldn't read that file."
      patch(draft.id, { state: "error", error: message, folder: /^Folders/.test(message) || draft.folder })
    }
  }, [])

  const start = useCallback(
    (list: File[], folders: File[] = []) => {
      const drafts = list.map((file) => ({ file, draft: draftOf(file) }))
      const refused = folders.map((file) => ({ ...draftOf(file), state: "error" as const, error: "Folders can't be attached yet.", folder: true }))
      setFiles((f) => [...f, ...drafts.map((d) => d.draft), ...refused])
      for (const { file, draft } of drafts) void copy(file, draft)
    },
    [copy],
  )

  // Files from the button, a paste or a drop. A drop says which of its items are folders.
  const add = useCallback(
    (list: File[], folders: File[] = []) => {
      if (!list.length && !folders.length) return
      if (list.some((f) => f.size > LARGE_FILE_BYTES)) {
        setAsking(list)
        if (folders.length) start([], folders)
        return
      }
      start(list, folders)
    },
    [start],
  )

  // A chip taken off before sending: its copy goes too
  const remove = useCallback((id: string) => {
    const gone = filesRef.current.find((f) => f.id === id)
    if (gone?.path && isDesktop) void rpc.chats.detach({ chatId: chatRef.current, path: gone.path }).catch(() => undefined)
    setFiles((list) => list.filter((f) => f.id !== id))
  }, [])

  // A PDF added to the Library from its chip is that paper from then on: a mention, not a file
  const addToLibrary = useCallback(
    async (id: string) => {
      const draft = filesRef.current.find((f) => f.id === id)
      if (!draft?.path) return
      const paper = await importCopy(draft)
      if (!paper) return
      remove(id)
      mentionRef.current(await paperMention(paper.id, draft.name))
    },
    [remove],
  )

  // What goes with the message: the files that are ready. The list empties for the next one.
  const take = useCallback((): AttachmentFile[] => {
    const ready = filesRef.current.filter((f) => f.state === "ready").map(({ state: _s, error: _e, folder: _f, ...file }) => file)
    setFiles([])
    return ready
  }, [])

  // Another chat's composer now (the panel moved to a new chat): copies made for the last one go
  useEffect(() => {
    if (chatRef.current === chatId) return
    for (const f of filesRef.current) if (f.path && isDesktop) void rpc.chats.detach({ chatId: chatRef.current, path: f.path }).catch(() => undefined)
    setFiles([])
    chatRef.current = chatId
  }, [chatId])

  const big = asking?.filter((f) => f.size > LARGE_FILE_BYTES) ?? []
  const dialog = (
    <Dialog open={!!asking} onOpenChange={(open) => !open && setAsking(null)}>
      {/* Focus would land on the title's info icon and open its tooltip */}
      <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeading title={big.length === 1 ? "Copy this large file?" : `Copy ${big.length} large files?`} about={ABOUT_COPIES} />
        <BorderedList as="ul">
          {big.map((f, i) => (
            <li key={i} className="flex h-9 items-center gap-3 px-3.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
            </li>
          ))}
        </BorderedList>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              // The smaller ones dropped with them are still attached
              const rest = asking?.filter((f) => f.size <= LARGE_FILE_BYTES) ?? []
              setAsking(null)
              if (rest.length) start(rest)
            }}
          >
            {asking && asking.length > big.length ? "Skip large files" : "Cancel"}
          </Button>
          <Button
            onClick={() => {
              const all = asking ?? []
              setAsking(null)
              start(all)
            }}
          >
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { files, add, remove, take, addToLibrary, adding: files.some((f) => f.state === "adding"), dialog }
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
    name: file.name || "Pasted file",
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
    reader.onerror = () => reject(reader.error ?? new Error("owlit couldn't read that file."))
    reader.readAsDataURL(file)
  })
  return url.slice(url.indexOf(",") + 1)
}

function docMention(path: string): AttachedMention {
  const file = fileAt(path)
  const mention = file ? docMentionable(file) : { id: path, kind: "doc" as const, title: displayName(path), subtitle: parentPath(path) || undefined, uri: docUri(path) }
  return { ...mention, label: displayName(path) }
}

async function paperMention(id: string, fallback: string): Promise<AttachedMention> {
  const paper = useLibraryStore.getState().papers[id]
  // A paper owlit knows no authors of (a local PDF) goes by its title rather than "Unknown"
  if (paper) return { ...paperMentionable(paper), label: paper.authors.length ? citationLabel(paper) : paper.title }
  return { id, kind: "paper", title: fallback, uri: paperUri(id), label: fallback }
}

// Adds an attached PDF's copy to the Library; the paper, or null when it couldn't be read (said in a toast)
export async function importCopy(file: AttachmentFile) {
  const root = useWorkspace.getState().current?.path
  if (!file.path || !root) return null
  try {
    const { paper, existed } = await importPdf(`${root}/${file.path}`)
    toast(existed ? "Already in your library" : "Added to library", { description: paper.title })
    return paper
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Couldn't add that file.")
    return null
  }
}
