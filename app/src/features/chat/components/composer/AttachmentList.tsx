import { FileIcon, FileTextIcon, ImageIcon, XIcon } from "lucide-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
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

export function AttachmentList({
  files,
  onRemove,
  size = "sm",
}: {
  files: AttachmentFile[]
  onRemove?: (id: string) => void
  size?: "sm" | "xs"
}) {
  if (files.length === 0) return null
  return (
    <AttachmentGroup>
      {files.map((f) => (
        <Attachment key={f.id} size={size}>
          <AttachmentMedia variant={f.previewUrl ? "image" : "icon"}>
            {f.previewUrl ? <img src={f.previewUrl} alt="" /> : iconFor(f.mimeType)}
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{f.name}</AttachmentTitle>
            <AttachmentDescription>{formatBytes(f.size)}</AttachmentDescription>
          </AttachmentContent>
          {onRemove && (
            <AttachmentActions>
              <AttachmentAction onClick={() => onRemove(f.id)} aria-label={`Remove ${f.name}`}>
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          )}
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}
