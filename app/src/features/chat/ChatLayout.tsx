import { Outlet, useNavigate } from "react-router-dom"
import { useShortcut } from "@/app/shortcuts"
import { FRESH_CHAT } from "./components/ChatEmpty"

// Hosts the chat routes plus chat-wide dialogs and shortcuts. Agents never checked are checked by the
// store (connectors.ts) as soon as it knows them.
export function ChatLayout() {
  const navigate = useNavigate()
  useShortcut("new", () => navigate("/chat", { state: FRESH_CHAT }))
  return <Outlet />
}
