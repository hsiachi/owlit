import { useEffect } from "react"
import { Outlet } from "react-router-dom"
import { isDesktop } from "@/lib/rpc"
import { VersionsDialog } from "./components/VersionsDialog"
import { useDocsStore } from "./store"
import { useDocsUiStore } from "./ui-store"
import { useNewDoc } from "./use-new-doc"

// Hosts the doc routes plus the Docs shortcuts, and the Versions dialog, which opens from the doc's
// header or its row in the list
export function DocsLayout() {
  const newDoc = useNewDoc()
  const versionsId = useDocsUiStore((s) => s.versionsOf)
  const versionsFile = useDocsStore((s) => (versionsId ? s.files[versionsId] : undefined))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault()
        newDoc()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [newDoc])

  return (
    <>
      <Outlet />
      {isDesktop && versionsFile && (
        <VersionsDialog file={versionsFile} open onOpenChange={(open) => !open && useDocsUiStore.getState().showVersions(null)} />
      )}
    </>
  )
}
