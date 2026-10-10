import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAgentWindow } from "./store"

// The agent window is offered everywhere except Chat, which is the same conversation at full size
export const useAgentAllowed = () => !useLocation().pathname.startsWith("/chat")

// ⌘J (a new question) and ⇧⌘J (the panel with the current chat) anywhere but Chat
export function useAgentShortcut() {
  const allowed = useAgentAllowed()
  useEffect(() => {
    if (!allowed) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "j") {
        e.preventDefault()
        const agent = useAgentWindow.getState()
        if (e.shiftKey) agent.togglePanel()
        else agent.toggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [allowed])
}

// Opens a page from inside a chat. Followed from the Chat page, the chat comes along as the docked panel,
// as it does when Owlit opens a page itself (ui-actions): the reason to follow the link is usually to
// read it against the conversation. Another chat is just a switch, so it leaves the panel alone.
export function useOpenFromChat() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (to: string) => {
    const chatId = /^\/chat\/([^/]+)$/.exec(pathname)?.[1]
    navigate(to)
    if (chatId && !to.startsWith("/chat")) useAgentWindow.getState().showChat(decodeURIComponent(chatId))
  }
}
