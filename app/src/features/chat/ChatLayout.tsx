import { useEffect } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { useShortcut } from "@/app/shortcuts"
import { useChatStore } from "./store"

// Hosts the chat routes plus chat-wide dialogs and shortcuts
export function ChatLayout() {
  const navigate = useNavigate()

  // Probe agents that were never checked so the user never sees an "unknown" state
  useEffect(() => {
    const { connectors, checkConnector } = useChatStore.getState()
    for (const c of connectors) if (c.status === "unknown") void checkConnector(c.id)
  }, [])

  useShortcut("new", () => navigate("/chat"))

  return (
    <>
      <Outlet />
    </>
  )
}
