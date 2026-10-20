import { t } from "@lingui/core/macro"
import { useState } from "react"
import { BookPlusIcon, FileIcon, FileTextIcon, FolderIcon, ImageIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { type AttachmentFile, type FileKind, fileKindOf } from "@owlit/protocol"
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
import { Tip } from "@/components/tip"
import { fileUrl, hasCore } from "@/lib/rpc"
import { formatBytes, type ChipFile, type Reader } from "../../lib/attachments"
import { Spinner } from "@/components/ui/spinner"
import { useAfterWait } from "@/hooks/use-after-wait"

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return <ImageIcon />
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("markdown")) return <FileTextIcon />
  return <FileIcon />
}

// "Codex can't read PDFs": one sentence per kind, as the kind's words and their place vary by language
function cantRead(agent: string, kind: FileKind) {
  switch (kind) {
    case "text":
      return t`${agent} can't read text files`
    case "pdf":
      return t`${agent} can't read PDFs`
    case "image":
      return t`${agent} can't read images`
    case "word":
      return t`${agent} can't read Word files`
    case "other":
      return t`${agent} can't read this kind of file`
  }
}

// An attached image's picture: the one the window made while attaching, else owlit's copy
function pictureOf(f: AttachmentFile) {
  if (f.previewUrl) return f.previewUrl
  if (!hasCore || !f.path || !f.mimeType.startsWith("image/")) return undefined
  return fileUrl(`owlit-file://workspace/${f.path.split("/").map(encodeURIComponent).join("/")}`)
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
  const addingAWhile = useAfterWait(adding)
  const picture = pictureOf(f)
  const kind = fileKindOf(f.name, f.mimeType)
  // Said before sending, while the composer holds it; a sent message doesn't repeat it
  const unread = f.state === "ready" && reader?.cannotRead.includes(kind) ? cantRead(reader.name, kind) : null
  const canOpen = !!onOpen && !!f.path && f.state !== "adding" && f.state !== "error"
  const offerLibrary = !!onAddToLibrary && kind === "pdf" && !!f.path && !f.paperId && f.state !== "adding" && f.state !== "error"
  const state = f.state === "adding" ? "uploading" : f.state === "error" ? "error" : "done"
  const name = f.name

  return (
    <Attachment size={size} state={state} title={unread ?? f.error ?? f.name}>
      <AttachmentMedia variant={picture && !f.folder ? "image" : "icon"}>
        {f.folder ? <FolderIcon /> : picture ? <img src={picture} alt="" /> : iconFor(f.mimeType)}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{f.name}</AttachmentTitle>
        <AttachmentDescription className={unread ? "flex items-center gap-1" : undefined}>
          {f.state === "adding" ? (
            t`Adding…`
          ) : f.state === "error" ? (
            f.error
          ) : unread ? (
            <>
              <TriangleAlertIcon className="size-3 shrink-0 text-warning" />
              <span className="truncate">{unread}</span>
            </>
          ) : f.paperId ? (
            t`In your Library`
          ) : (
            formatBytes(f.size)
          )}
        </AttachmentDescription>
      </AttachmentContent>
      {canOpen && <AttachmentTrigger aria-label={t`Open ${name}`} onClick={() => onOpen?.(f)} />}
      {(offerLibrary || onRemove) && (
        <AttachmentActions>
          {offerLibrary && (
            <Tip label={t`Add to Library`}>
              <AttachmentAction
                aria-label={t`Add to Library`}
                disabled={adding}
                onClick={() => {
                  setAdding(true)
                  void onAddToLibrary?.(f).finally(() => setAdding(false))
                }}
              >
                {addingAWhile ? <Spinner wait={false} /> : <BookPlusIcon />}
              </AttachmentAction>
            </Tip>
          )}
          {onRemove && (
            <AttachmentAction onClick={() => onRemove(f.id)} aria-label={t`Remove ${name}`}>
              <XIcon />
            </AttachmentAction>
          )}
        </AttachmentActions>
      )}
    </Attachment>
  )
}
