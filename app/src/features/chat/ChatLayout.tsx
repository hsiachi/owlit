import { useEffect } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { ConnectorsDialog } from "./components/ConnectorsDialog"
import { useChatStore } from "./store"

// Hosts the chat routes plus chat-wide dialogs and shortcuts
export function ChatLayout() {
  const navigate = useNavigate()

  // Probe agents that were never checked so the user never sees an "unknown" state
  useEffect(() => {
    const { connectors, checkConnector } = useChatStore.getState()
    for (const c of connectors) if (c.status === "unknown") void checkConnector(c.id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault()
        navigate("/chat")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate])

  return (
    <>
      <Outlet />
      <ConnectorsDialog />
    </>
  )
}
