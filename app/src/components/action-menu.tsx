import { Fragment } from "react"
import { CheckIcon } from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"

// A row's actions are one list, reached from its ⋯ and by right-clicking it, so the two never disagree.
// Groups are drawn with a separator between them; empty groups are dropped.
export interface MenuAction {
  label: string
  // Absent on an item that only opens its submenu
  onSelect?: () => void
  destructive?: boolean
  disabled?: boolean
  // The current choice in a submenu, ticked at the right
  checked?: boolean
  // A small mark before the label (a highlight's colour dot)
  mark?: React.ReactNode
  // A submenu, and its width
  children?: MenuAction[]
  childrenClassName?: string
}

export type MenuGroups = MenuAction[][]

// The two Radix menus share markup shape but not components, so the list is drawn with a kit
interface Kit {
  Item: typeof DropdownMenuItem
  Separator: typeof DropdownMenuSeparator
  Sub: typeof DropdownMenuSub
  SubTrigger: typeof DropdownMenuSubTrigger
  SubContent: typeof DropdownMenuSubContent
}

const dropdownKit: Kit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
}
const contextKit: Kit = {
  Item: ContextMenuItem as unknown as typeof DropdownMenuItem,
  Separator: ContextMenuSeparator as unknown as typeof DropdownMenuSeparator,
  Sub: ContextMenuSub as unknown as typeof DropdownMenuSub,
  SubTrigger: ContextMenuSubTrigger as unknown as typeof DropdownMenuSubTrigger,
  SubContent: ContextMenuSubContent as unknown as typeof DropdownMenuSubContent,
}

function renderItem(a: MenuAction, k: Kit) {
  if (a.children)
    return (
      <k.Sub key={a.label}>
        <k.SubTrigger disabled={a.disabled || !a.children.length}>{a.label}</k.SubTrigger>
        <k.SubContent className={a.childrenClassName ?? "w-40"}>{a.children.map((c) => renderItem(c, k))}</k.SubContent>
      </k.Sub>
    )
  return (
    <k.Item key={a.label} variant={a.destructive ? "destructive" : "default"} disabled={a.disabled} onSelect={a.onSelect}>
      {a.mark}
      <span className="truncate">{a.label}</span>
      {a.checked && <CheckIcon className="ml-auto text-muted-foreground" />}
    </k.Item>
  )
}

function renderGroups(groups: MenuGroups, k: Kit) {
  return groups
    .filter((g) => g.length)
    .map((group, i) => (
      <Fragment key={i}>
        {i > 0 && <k.Separator />}
        {group.map((a) => renderItem(a, k))}
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
export function ActionsOnRightClick({
  groups,
  onOpen,
  className,
  children,
}: {
  groups: MenuGroups
  onOpen?: () => void
  className?: string
  children: React.ReactNode
}) {
  // Nothing to offer (a row being renamed): the system's own menu, as in any text field
  if (!groups.some((g) => g.length)) return children
  return (
    <ContextMenu onOpenChange={(open) => open && onOpen?.()}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={className ?? "w-44"} onCloseAutoFocus={(e) => e.preventDefault()}>
        {renderGroups(groups, contextKit)}
      </ContextMenuContent>
    </ContextMenu>
  )
}
