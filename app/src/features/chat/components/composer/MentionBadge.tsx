import type { Mentionable } from "../../types"
import { MentionToken } from "@/components/mention/mention-token"
import { usePaperUnread } from "@/features/docs/lib/mentions"

// Read-only token used when echoing mentions in sent messages
export function MentionBadge({ item, className }: { item: Mentionable; className?: string }) {
  const unread = usePaperUnread(item.uri)
  return (
    <MentionToken
      label={item.title}
      unread={unread}
      className={className}
      title={item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}
    />
  )
}
