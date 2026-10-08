import { useEffect } from "react"
import { useLocation } from "react-router-dom"
import { useAgentWindow } from "./store"

// The agent window is offered everywhere except Chat, which is the same conversation at full size
export const useAgentAllowed = () => !useLocation().pathname.startsWith("/chat")

// ⌘J anywhere but Chat
export function useAgentShortcut() {
  const allowed = useAgentAllowed()
  useEffect(() => {
    if (!allowed) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault()
        useAgentWindow.getState().toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [allowed])
}
