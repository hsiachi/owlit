import { useLocation, useNavigate } from "react-router-dom"
import { routeSubject } from "@/app/route-subject"
import { useShortcut } from "@/app/shortcuts"
import { useAgentWindow } from "./store"

// The agent window is offered everywhere except Chat, which is the same conversation at full size
export const useAgentAllowed = () => !useLocation().pathname.startsWith("/chat")

// ⌘J (a new question) and ⇧⌘J (the panel with the current chat) anywhere but Chat
export function useAgentShortcut() {
  const enabled = useAgentAllowed()
  useShortcut("owlit", () => useAgentWindow.getState().toggle(), { enabled })
  useShortcut("owlit-panel", () => useAgentWindow.getState().togglePanel(), { enabled })
}

// Opens a page from inside a chat. Followed from the Chat page, the chat comes along as the docked panel,
// as it does when Owlit opens a page itself (ui-actions): the reason to follow the link is usually to
// read it against the conversation. Another chat is just a switch, so it leaves the panel alone.
function openFromChat(navigate: (to: string) => unknown, pathname: string, to: string) {
  const here = routeSubject(pathname)
  void navigate(to)
  if (here?.kind === "chat" && !to.startsWith("/chat")) useAgentWindow.getState().showChat(here.id)
}

export function useOpenFromChat() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (to: string) => openFromChat(navigate, pathname, to)
}
