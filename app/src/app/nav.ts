import type { MessageDescriptor } from "@lingui/core"
import { msg } from "@lingui/core/macro"
import type { ComponentType } from "react"
import { HouseIcon, type LucideIcon } from "lucide-react"
import { ChatListPanel } from "@/features/chat/components/ChatListPanel"
import { DocsListPanel } from "@/features/docs/components/DocsListPanel"
import { KIND_ICON } from "@/lib/kinds"

export interface NavItem {
  to: string
  // Said where it shows, in the interface's language
  label: MessageDescriptor
  icon: LucideIcon
  // Content of the second-column list panel, when this place has one
  panel?: ComponentType
}

export const nav: NavItem[] = [
  { to: "/", label: msg`Home`, icon: HouseIcon },
  { to: "/chat", label: msg`Chat`, icon: KIND_ICON.chat, panel: ChatListPanel },
  { to: "/docs", label: msg`Docs`, icon: KIND_ICON.doc, panel: DocsListPanel },
  { to: "/knowledge", label: msg`Knowledge`, icon: KIND_ICON.knowledge },
  { to: "/library", label: msg`Library`, icon: KIND_ICON.paper },
]

export function matchNav(pathname: string) {
  return nav.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)))
}
