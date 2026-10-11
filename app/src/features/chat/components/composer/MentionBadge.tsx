import type { Mentionable } from "../../types"
import { MentionToken } from "@/components/mention/mention-token"

// Read-only token used when echoing mentions in sent messages
export function MentionBadge({ item, className }: { item: Mentionable; className?: string }) {
  return (
    <MentionToken
      label={item.title}
      className={className}
      title={item.subtitle ? `${item.title} · ${item.subtitle}` : item.title}
    />
  )
}
