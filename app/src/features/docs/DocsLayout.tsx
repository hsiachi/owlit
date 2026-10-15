import { Outlet } from "react-router-dom"
import { useShortcut } from "@/app/shortcuts"
import { isDesktop } from "@/lib/rpc"
import { VersionsDialog } from "./components/VersionsDialog"
import { ResolvedComments } from "./comments/ResolvedComments"
import { useDocsStore } from "./store"
import { useDocsUiStore } from "./ui-store"
import { useNewDoc } from "./use-new-doc"

// Hosts the doc routes plus the Docs shortcuts, and the Versions and Resolved comments dialogs, which open
// from the doc's header or its row in the list
export function DocsLayout() {
  const newDoc = useNewDoc()
  const versionsId = useDocsUiStore((s) => s.versionsOf)
  const versionsFile = useDocsStore((s) => (versionsId ? s.files[versionsId] : undefined))
  const resolvedId = useDocsUiStore((s) => s.resolvedOf)
  const resolvedFile = useDocsStore((s) => (resolvedId ? s.files[resolvedId] : undefined))

  useShortcut("new", () => newDoc())

  return (
    <>
      <Outlet />
      {isDesktop && versionsFile && (
        <VersionsDialog file={versionsFile} open onOpenChange={(open) => !open && useDocsUiStore.getState().showVersions(null)} />
      )}
      {resolvedFile && <ResolvedComments file={resolvedFile} open onOpenChange={(open) => !open && useDocsUiStore.getState().showResolved(null)} />}
    </>
  )
}
