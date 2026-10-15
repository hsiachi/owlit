import { t } from "@lingui/core/macro"
import { XIcon } from "lucide-react"
import type { Mentionable, QuotedSelection } from "@/features/chat/types"
import { shorten } from "@/lib/words"
import { selectionLabel } from "./page-context"
import { useAgentWindow } from "./store"

// A chip's ×, for a doc, paper or topic by its name
export const dontInclude = (name: string) => t`Don't include ${name}`

// What goes with the question besides its text (the page, a passage, a mention), each with × to leave it out
export function Chip({ children, onRemove, label }: { children: React.ReactNode; onRemove: () => void; label: string }) {
  return (
    <span className="inline-flex h-6 max-w-full min-w-0 items-center gap-0.5 rounded-md bg-muted pr-0.5 pl-2 text-xs text-muted-foreground">
      <span className="min-w-0 truncate">{children}</span>
      <button
        type="button"
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onRemove}
        className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </span>
  )
}

// The passage, as its chip says it: where it came from and its first words
export function SelectionChip({ selection, length }: { selection: QuotedSelection; length: number }) {
  return (
    <Chip label={t`Don't include the selection`} onRemove={() => useAgentWindow.getState().clearSelection()}>
      {selectionLabel(selection)} · “{shorten(selection.text, length)}”
    </Chip>
  )
}

export function ContextChips({ context, selection }: { context: Mentionable[]; selection: QuotedSelection | null }) {
  return (
    <>
      {context.map((c) => (
        <Chip key={c.uri} label={dontInclude(c.title)} onRemove={() => useAgentWindow.getState().hideContext(c.uri)}>
          <span className="text-mention">{c.title}</span>
        </Chip>
      ))}
      {selection && <SelectionChip selection={selection} length={40} />}
    </>
  )
}
