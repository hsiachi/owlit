import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { paperUri } from "@owlit/protocol"
import { cn } from "@/lib/utils"
import { MentionToken } from "@/components/mention/mention-token"
import { usePaperUnread } from "@/features/docs/lib/mentions"

// Inline token rendered for a mention node inside the editor (the composer, a paper's note)
export function MentionChip({ node, selected }: NodeViewProps) {
  const unread = usePaperUnread(node.attrs.kind === "paper" ? paperUri(node.attrs.id) : null)
  return (
    <NodeViewWrapper as="span" data-type="mention" className="mx-px inline">
      <MentionToken variant="field" label={node.attrs.label} unread={unread} className={cn(selected && "ring-2 ring-ring/50")} />
    </NodeViewWrapper>
  )
}
