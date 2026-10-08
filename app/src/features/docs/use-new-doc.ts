import { useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useDocsStore } from "./store"
import { useDocsUiStore } from "./ui-store"

// Starts an empty doc and opens it. It never asks where: an explicit folder, else the folder last
// clicked or the open doc's folder, else the workspace root.
export function useNewDoc() {
  const navigate = useNavigate()
  return useCallback(
    (folder?: string) => {
      const target = folder ?? useDocsUiStore.getState().targetFolder
      const known = target === "" || useDocsStore.getState().folders.includes(target) || Object.values(useDocsStore.getState().files).some((f) => f.path.startsWith(target + "/"))
      const file = useDocsStore.getState().createDoc(known ? target : "")
      if (known && target) useDocsUiStore.getState().expandTo(target)
      useDocsUiStore.getState().setQuery("")
      navigate(`/docs/${file.id}`)
    },
    [navigate],
  )
}
