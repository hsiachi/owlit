import type { ComponentType } from "react"
import { BookOpen, FileText, House, MessageSquare, Network } from "lucide-react"
import { ChatListPanel } from "@/features/chat/components/ChatListPanel"

export interface NavItem {
  to: string
  label: string
  icon: typeof House
  // Content of the second-column list panel, when this place has one
  panel?: ComponentType
}

export const nav: NavItem[] = [
  { to: "/", label: "Home", icon: House },
  { to: "/chat", label: "Chat", icon: MessageSquare, panel: ChatListPanel },
  { to: "/docs", label: "Docs", icon: FileText },
  { to: "/knowledge", label: "Knowledge", icon: Network },
  { to: "/library", label: "Library", icon: BookOpen },
]

export function matchNav(pathname: string) {
  return nav.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))
}
