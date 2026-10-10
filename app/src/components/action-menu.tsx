import { Fragment } from "react"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"

// A row's actions are one list, reached from its ⋯ and by right-clicking it, so the two never disagree.
// Groups are drawn with a separator between them; empty groups are dropped.
export interface MenuAction {
  label: string
  onSelect: () => void
  destructive?: boolean
}

export type MenuGroups = MenuAction[][]

// The two Radix menus share markup shape but not components, so the list is drawn with a kit
interface Kit {
  Item: typeof DropdownMenuItem
  Separator: typeof DropdownMenuSeparator
}

const dropdownKit: Kit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator }
const contextKit: Kit = {
  Item: ContextMenuItem as unknown as typeof DropdownMenuItem,
  Separator: ContextMenuSeparator as unknown as typeof DropdownMenuSeparator,
}

function renderGroups(groups: MenuGroups, k: Kit) {
  return groups
    .filter((g) => g.length)
    .map((group, i) => (
      <Fragment key={i}>
        {i > 0 && <k.Separator />}
        {group.map((a) => (
          <k.Item key={a.label} variant={a.destructive ? "destructive" : "default"} onSelect={a.onSelect}>
            {a.label}
          </k.Item>
        ))}
      </Fragment>
    ))
}

// Focus isn't handed back to the trigger on close: a rename input or the next row may want it
export function ActionsDropdownContent({ groups, ...props }: { groups: MenuGroups } & Omit<React.ComponentProps<typeof DropdownMenuContent>, "children">) {
  return (
    <DropdownMenuContent className="w-44" onCloseAutoFocus={(e) => e.preventDefault()} {...props}>
      {renderGroups(groups, dropdownKit)}
    </DropdownMenuContent>
  )
}

// Wraps a row so right-clicking it opens its actions where the pointer is. `onOpen` runs as the menu opens
// (the row it was opened on may need to become the selection).
export function ActionsOnRightClick({ groups, onOpen, children }: { groups: MenuGroups; onOpen?: () => void; children: React.ReactNode }) {
  // Nothing to offer (a row being renamed): the system's own menu, as in any text field
  if (!groups.some((g) => g.length)) return children
  return (
    <ContextMenu onOpenChange={(open) => open && onOpen?.()}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
        {renderGroups(groups, contextKit)}
      </ContextMenuContent>
    </ContextMenu>
  )
}
