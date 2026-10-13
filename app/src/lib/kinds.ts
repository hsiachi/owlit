import { t } from "@lingui/core/macro"
import { BookOpenIcon, BotIcon, FileTextIcon, MessageSquareIcon, NetworkIcon, StickyNoteIcon, type LucideIcon } from "lucide-react"

// The kinds of thing a workspace holds, each drawn with one icon wherever it appears: the rail, the
// palette, Home, the mention popup, a result card
export type Kind = "doc" | "chat" | "paper" | "knowledge" | "note" | "agent"

export const KIND_ICON: Record<Kind, LucideIcon> = {
  doc: FileTextIcon,
  chat: MessageSquareIcon,
  paper: BookOpenIcon,
  knowledge: NetworkIcon,
  note: StickyNoteIcon,
  agent: BotIcon,
}

// The place that holds each kind a mention can name. Getters, so each name is said in the interface's
// language when it is read, not once at import.
export const KIND_PLACE = {
  get paper() {
    return t`Library`
  },
  get doc() {
    return t`Docs`
  },
  get knowledge() {
    return t`Knowledge`
  },
} satisfies Partial<Record<Kind, string>>
