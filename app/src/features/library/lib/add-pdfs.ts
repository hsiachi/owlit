import { plural, t } from "@lingui/core/macro"
import { toast } from "sonner"
import { filePath } from "@/lib/rpc"
import { toastError, toastUndo } from "@/lib/toast"
import { addPaperFrom, sayAdded, undoAdded, type Added } from "../actions"
import { useLibraryUi } from "../ui-store"

// Adds the papers in `files` and peeks the last one. Shared with the page-wide drop target. Core
// recognises each file (arXiv's stamp, a DOI) and keeps it in the workspace; one that can't be read
// doesn't stop the rest. open: the toast's Open.
export async function addPdfFiles(files: File[], open: (id: string) => void) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name))
  if (pdfs.length === 0) {
    toast.error(t`Only PDF files can be added this way.`)
    return
  }
  const last = await importInCore(pdfs, open)
  if (last) useLibraryUi.getState().revealPaper(last)
}

async function importInCore(pdfs: File[], open: (id: string) => void) {
  // Recognising a file can mean asking the services, which takes a few seconds
  const total = pdfs.length
  const name = pdfs[0].name
  const progress = toast.loading(total > 1 ? t`Adding 1 of ${total}…` : t`Adding ${name}…`)
  let last: Added | null = null
  const added: string[] = []
  let existing = 0
  let placed = 0
  const unread: string[] = []
  for (const [i, file] of pdfs.entries()) {
    const number = i + 1
    if (total > 1) toast.loading(t`Adding ${number} of ${total}…`, { id: progress })
    try {
      last = await addPaperFrom({ file: filePath(file) })
      if (last.placed) placed++
      else if (last.existed) existing++
      else added.push(last.paper.id)
    } catch (error) {
      unread.push(file.name)
      if (pdfs.length === 1) toastError(error, t`Couldn't add that file.`)
    }
  }
  toast.dismiss(progress)
  if (pdfs.length === 1) {
    if (last) sayAdded(last, open)
    return last?.paper.id ?? null
  }
  const count = added.length
  const unreadCount = unread.length
  // Each count its own message, side by side: "3 added · 1 PDF attached · 1 already in your library"
  const parts = [
    t`${count} added`,
    placed && plural(placed, { one: "# PDF attached", other: "# PDFs attached" }),
    existing && t`${existing} already in your library`,
    unreadCount && t`${unreadCount} couldn't be read`,
  ].filter(Boolean)
  const description = unread.length ? unread.join(", ") : undefined
  if (count) toastUndo(parts.join(" · "), () => undoAdded(added), { description })
  else toast(parts.join(" · "), { description })
  return last?.paper.id ?? null
}
