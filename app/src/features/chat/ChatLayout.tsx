import { useEffect } from "react"
import { Outlet, useNavigate } from "react-router-dom"
import { ChatSearchDialog } from "./components/ChatSearchDialog"
import { ConnectorsDialog } from "./components/ConnectorsDialog"
import { useUiStore } from "./ui-store"

// Hosts the chat routes plus chat-wide dialogs and shortcuts
export function ChatLayout() {
  const navigate = useNavigate()
  const setSearchOpen = useUiStore((s) => s.setSearchOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearchOpen(true)
      } else if (e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault()
        navigate("/chat")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navigate, setSearchOpen])

  return (
    <>
      <Outlet />
      <ChatSearchDialog />
      <ConnectorsDialog />
    </>
  )
}
