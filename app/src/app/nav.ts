import { BookOpen, FileText, House, MessageSquare, Network } from "lucide-react"

// panel: whether this place has the second-column list panel (only Chat for now)
export const nav = [
  { to: "/", label: "Home", icon: House },
  { to: "/chat", label: "Chat", icon: MessageSquare, panel: true },
  { to: "/docs", label: "Docs", icon: FileText },
  { to: "/knowledge", label: "Knowledge", icon: Network },
  { to: "/library", label: "Library", icon: BookOpen },
]

export function matchNav(pathname: string) {
  return nav.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))
}
