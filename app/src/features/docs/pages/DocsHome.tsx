import { Navigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { keysFor } from "@/app/shortcuts"
import { useDocsStore } from "../store"
import { isMarkdown } from "../types"
import { useDocsUiStore } from "../ui-store"
import { useNewDoc } from "../use-new-doc"

// Docs has no landing page of its own: it goes back to the doc you were in, or the latest one
export function DocsHome() {
  const files = useDocsStore((s) => s.files)
  const loaded = useDocsStore((s) => s.loaded)
  const lastDocId = useDocsUiStore((s) => s.lastDocId)
  const newDoc = useNewDoc()

  const docs = Object.values(files).filter((f) => isMarkdown(f.path))
  const target = (lastDocId && files[lastDocId] && isMarkdown(files[lastDocId].path) ? files[lastDocId] : null) ?? docs.sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
  if (target) return <Navigate to={`/docs/${target.id}`} replace />
  // The workspace is still being read
  if (!loaded) return null

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-[15px] font-medium">No docs yet</p>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">Notes and drafts live here as Markdown files in your workspace. Files you add in Finder show up too.</p>
      <Button size="sm" className="mt-1" onClick={() => newDoc()}>
        New doc
        <Kbd className="bg-transparent text-primary-foreground/60">{keysFor("new")}</Kbd>
      </Button>
      <p className="mt-2 text-[13px] text-muted-foreground">In a doc, type @ to cite a paper.</p>
    </div>
  )
}
