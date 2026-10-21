import { forwardRef, useImperativeHandle, useState } from "react"
import { t } from "@lingui/core/macro"
import type { CommandName } from "@owlit/protocol"
import { cn } from "@/lib/utils"
import { commandWords } from "../../lib/commands"

export interface CommandListHandle {
  onKeyDown: (props: { event: Pick<KeyboardEvent, "key"> }) => boolean
}

export interface CommandListProps {
  items: CommandName[]
  command: (name: CommandName) => void
}

// The "/" popup at the start of a message: each command with what it does. Drawn on the same surface as
// the "@" popup; its editor drives the keyboard through the handle.
export const CommandList = forwardRef<CommandListHandle, CommandListProps>(function CommandList({ items, command }, ref) {
  const [index, setIndex] = useState(0)
  // Reset the highlight whenever the list changes (adjusting state during render)
  const [basis, setBasis] = useState(items)
  if (basis !== items) {
    setBasis(items)
    setIndex(0)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false
      if (event.key === "ArrowDown") {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === "ArrowUp") {
        setIndex((i) => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === "Enter" || event.key === "Tab") {
        command(items[index]!)
        return true
      }
      return false
    },
  }))

  return (
    <div className="menu-surface flex w-[26rem] flex-col overflow-hidden rounded-xl p-1 text-popover-foreground" role="listbox" aria-label={t`Commands`}>
      {items.length === 0 && <div className="px-3 py-2.5 text-sm text-muted-foreground">{t`No matches`}</div>}
      {items.map((name, i) => (
        <button
          key={name}
          type="button"
          role="option"
          aria-selected={i === index}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setIndex(i)}
          onClick={() => command(name)}
          className={cn("flex w-full flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-left outline-hidden", i === index && "bg-muted")}
        >
          <span className="font-mono text-sm">/{name}</span>
          <span className="text-xs text-muted-foreground">{commandWords(name)}</span>
        </button>
      ))}
    </div>
  )
})
