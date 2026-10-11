import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { cn } from "@/lib/utils"
import { MentionToken } from "@/components/mention/mention-token"

// Inline token rendered for a mention node inside the editor
export function MentionChip({ node, selected }: NodeViewProps) {
  return (
    <NodeViewWrapper as="span" data-type="mention" className="mx-px inline">
      <MentionToken variant="field" label={node.attrs.label} className={cn(selected && "ring-2 ring-ring/50")} />
    </NodeViewWrapper>
  )
}
