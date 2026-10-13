import { t } from "@lingui/core/macro"
import { Navigate } from "react-router-dom"
import { DropCard } from "@/components/empty-place"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { keysFor } from "@/app/shortcuts"
import { isHidden } from "../lib/tree"
import { useDocsStore } from "../store"
import { isMarkdown, type WorkspaceFile } from "../types"
import { useDocsUiStore } from "../ui-store"
import { useNewDoc } from "../use-new-doc"

// Docs has no landing page of its own: it goes back to the doc you were in, or the latest one. Only docs the
// tree shows count; Knowledge topics are Markdown too and Owlit edits them often, so they would win otherwise.
const isDoc = (f: WorkspaceFile | undefined): f is WorkspaceFile => !!f && isMarkdown(f.path) && !isHidden(f.path)

export function DocsHome() {
  const files = useDocsStore((s) => s.files)
  const loaded = useDocsStore((s) => s.loaded)
  const lastDocId = useDocsUiStore((s) => s.lastDocId)
  const newDoc = useNewDoc()

  const last = lastDocId ? files[lastDocId] : undefined
  const target = isDoc(last) ? last : Object.values(files).filter(isDoc).sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
  if (target) return <Navigate to={`/docs/${target.id}`} replace />
  // The workspace is still being read
  if (!loaded) return null

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <DropCard
        title={t`No docs yet`}
        detail={t`Notes and drafts live here as Markdown files in your workspace. Files you add in Finder show up too.`}
        actions={
          <Button size="sm" onClick={() => newDoc()}>
            {t`New doc`}
            <Kbd className="bg-transparent text-primary-foreground/60">{keysFor("new")}</Kbd>
          </Button>
        }
      />
      <p className="mt-4 text-detail text-muted-foreground">{t`In a doc, type @ to cite a paper.`}</p>
    </div>
  )
}
