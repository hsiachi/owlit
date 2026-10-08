import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { cn } from "cn"
import type { SourceKind } from "../../types"
import { SourceIcon } from "../source-icons"

// Inline chip rendered for a mention node inside the editor
export function MentionChip({ node, selected }: NodeViewProps) {
  const kind = node.attrs.kind as SourceKind
  return (
    <NodeViewWrapper
      as="span"
      data-type="mention"
      className={cn(
        "mx-px inline-flex max-w-72 items-center gap-1 rounded-md bg-muted px-1.5 py-px align-baseline text-[0.9em] text-foreground",
        selected && "ring-2 ring-ring/50",
      )}
    >
      <SourceIcon kind={kind} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.attrs.label}</span>
    </NodeViewWrapper>
  )
}
