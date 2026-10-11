import { useState } from "react"
import { BookPlusIcon, FileIcon, FileTextIcon, FolderIcon, ImageIcon, Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react"
import { FILE_KIND_NAMES, fileKindOf, type FileKind } from "@owlit/protocol"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isDesktop } from "@/lib/rpc"
import type { AttachmentFile } from "../../types"

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon />
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("markdown")) return <FileTextIcon />
  return <FileIcon />
}

// An attached image's picture: the one the window made while attaching, else owlit's copy
function pictureOf(f: AttachmentFile) {
  if (f.previewUrl) return f.previewUrl
  if (!isDesktop || !f.path || !f.mimeType.startsWith("image/")) return undefined
  return `owlit-file://workspace/${f.path.split("/").map(encodeURIComponent).join("/")}`
}

export interface ChipFile extends AttachmentFile {
  // Set while it is in the composer: being copied, or refused (with why)
  state?: "adding" | "ready" | "error"
  error?: string
  folder?: boolean
}

// The agent the message goes to, when it can't read some kinds of file (Connector.cannotRead)
export interface Reader {
  name: string
  cannotRead: FileKind[]
}

export function AttachmentList({
  files,
  onRemove,
  onOpen,
  onAddToLibrary,
  reader,
  size = "sm",
}: {
  files: ChipFile[]
  onRemove?: (id: string) => void
  // Opens the copy in the system's app
  onOpen?: (file: AttachmentFile) => void
  // Offered on a PDF that isn't in the Library
  onAddToLibrary?: (file: AttachmentFile) => Promise<unknown>
  reader?: Reader
  size?: "sm" | "xs"
}) {
  if (files.length === 0) return null
  return (
    <AttachmentGroup>
      {files.map((f) => (
        <FileChip key={f.id} file={f} size={size} reader={reader} onRemove={onRemove} onOpen={onOpen} onAddToLibrary={onAddToLibrary} />
      ))}
    </AttachmentGroup>
  )
}

function FileChip({
  file: f,
  size,
  reader,
  onRemove,
  onOpen,
  onAddToLibrary,
}: {
  file: ChipFile
  size: "sm" | "xs"
  reader?: Reader
  onRemove?: (id: string) => void
  onOpen?: (file: AttachmentFile) => void
  onAddToLibrary?: (file: AttachmentFile) => Promise<unknown>
}) {
  const [adding, setAdding] = useState(false)
  const picture = pictureOf(f)
  const kind = fileKindOf(f.name, f.mimeType)
  // Said before sending, while the composer holds it; a sent message doesn't repeat it
  const unread = f.state === "ready" && reader?.cannotRead.includes(kind) ? `${reader.name} can't read ${FILE_KIND_NAMES[kind]}` : null
  const canOpen = !!onOpen && !!f.path && f.state !== "adding" && f.state !== "error"
  const offerLibrary = !!onAddToLibrary && kind === "pdf" && !!f.path && !f.paperId && f.state !== "adding" && f.state !== "error"
  const state = f.state === "adding" ? "uploading" : f.state === "error" ? "error" : "done"

  return (
    <Attachment size={size} state={state} title={unread ?? f.error ?? f.name}>
      <AttachmentMedia variant={picture && !f.folder ? "image" : "icon"}>
        {f.folder ? <FolderIcon /> : picture ? <img src={picture} alt="" /> : iconFor(f.mimeType)}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{f.name}</AttachmentTitle>
        <AttachmentDescription className={unread ? "flex items-center gap-1" : undefined}>
          {f.state === "adding" ? (
            "Adding…"
          ) : f.state === "error" ? (
            f.error
          ) : unread ? (
            <>
              <TriangleAlertIcon className="size-3 shrink-0 text-warning" />
              <span className="truncate">{unread}</span>
            </>
          ) : f.paperId ? (
            "In your Library"
          ) : (
            formatBytes(f.size)
          )}
        </AttachmentDescription>
      </AttachmentContent>
      {canOpen && <AttachmentTrigger aria-label={`Open ${f.name}`} onClick={() => onOpen?.(f)} />}
      {(offerLibrary || onRemove) && (
        <AttachmentActions>
          {offerLibrary && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AttachmentAction
                  aria-label="Add to Library"
                  disabled={adding}
                  onClick={() => {
                    setAdding(true)
                    void onAddToLibrary?.(f).finally(() => setAdding(false))
                  }}
                >
                  {adding ? <Loader2Icon className="animate-spin" /> : <BookPlusIcon />}
                </AttachmentAction>
              </TooltipTrigger>
              <TooltipContent>Add to Library</TooltipContent>
            </Tooltip>
          )}
          {onRemove && (
            <AttachmentAction onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`}>
              <XIcon />
            </AttachmentAction>
          )}
        </AttachmentActions>
      )}
    </Attachment>
  )
}
