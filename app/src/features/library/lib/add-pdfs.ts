import { toast } from "sonner"
import { libraryClient, useLibraryStore } from "../store"
import { useUiStore } from "../ui-store"

// Adds the papers in `files` and peeks the last one. Shared with the page-wide drop target.
export async function addPdfFiles(files: File[]) {
  const pdfs = files.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name))
  if (pdfs.length === 0) {
    toast.error("Only PDF files can be added this way.")
    return
  }
  const { addPaper } = useLibraryStore.getState()
  let last: string | null = null
  for (const file of pdfs) {
    const resolved = await libraryClient.importPdf(file)
    last = addPaper(resolved).id
  }
  if (last) useUiStore.setState({ selectedIds: [last], cursorId: last, anchorId: last, peekId: last, query: "", filter: "all", tags: [] })
  toast(pdfs.length === 1 ? "Added to library" : `Added ${pdfs.length} papers`, {
    description: pdfs.length === 1 ? pdfs[0].name : undefined,
  })
}
