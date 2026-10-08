import { useEffect } from "react"
import { Outlet } from "react-router-dom"
import { useNewDoc } from "./use-new-doc"

// Hosts the doc routes plus the Docs shortcuts
export function DocsLayout() {
  const newDoc = useNewDoc()

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

  return <Outlet />
}
