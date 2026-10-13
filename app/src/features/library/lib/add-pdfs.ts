import { plural, t } from "@lingui/core/macro"
import { toast } from "sonner"
import { filePath, isDesktop } from "@/lib/rpc"
import { importPdf } from "../disk"
import { libraryClient, useLibraryStore } from "../store"
import { useLibraryUi } from "../ui-store"

// Adds the papers in `files` and peeks the last one. Shared with the page-wide drop target. In the
// desktop app core recognises each file (arXiv's stamp, a DOI) and keeps it in the workspace; one that
// can't be read doesn't stop the rest.
export async function addPdfFiles(files: File[]) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name))
  if (pdfs.length === 0) {
    toast.error(t`Only PDF files can be added this way.`)
    return
  }
  const last = isDesktop ? await importInCore(pdfs) : await addInBrowser(pdfs)
  if (last) useLibraryUi.getState().revealPaper(last)
}

async function importInCore(pdfs: File[]) {
  // Recognising a file can mean asking the services, which takes a few seconds
  const total = pdfs.length
  const name = pdfs[0].name
  const progress = toast.loading(total > 1 ? t`Adding 1 of ${total}…` : t`Adding ${name}…`)
  let last: string | null = null
  let added = 0
  let existing = 0
  const unread: string[] = []
  let lastTitle = ""
  for (const [i, file] of pdfs.entries()) {
    const number = i + 1
    if (total > 1) toast.loading(t`Adding ${number} of ${total}…`, { id: progress })
    try {
      const { paper, existed } = await importPdf(filePath(file))
      last = paper.id
      lastTitle = paper.title
      if (existed) existing++
      else added++
    } catch (error) {
      unread.push(file.name)
      if (pdfs.length === 1) toast.error(error instanceof Error ? error.message : t`Couldn't add that file.`)
    }
  }
  toast.dismiss(progress)
  if (pdfs.length === 1) {
    if (added) toast(t`Added to library`, { description: lastTitle })
    else if (existing) toast(t`Already in your library`, { description: lastTitle })
    return last
  }
  const unreadCount = unread.length
  // Each count its own message, side by side: "3 added · 1 already in your library"
  const parts = [t`${added} added`, existing && t`${existing} already in your library`, unreadCount && t`${unreadCount} couldn't be read`].filter(Boolean)
  toast(parts.join(" · "), { description: unread.length ? unread.join(", ") : undefined })
  return last
}

async function addInBrowser(pdfs: File[]) {
  const { addPaper } = useLibraryStore.getState()
  let last: string | null = null
  for (const file of pdfs) {
    const resolved = await libraryClient.importPdf?.(file)
    if (resolved) last = addPaper(resolved).id
  }
  toast(pdfs.length === 1 ? t`Added to library` : plural(pdfs.length, { one: "Added # paper", other: "Added # papers" }), {
    description: pdfs.length === 1 ? pdfs[0].name : undefined,
  })
  return last
}
