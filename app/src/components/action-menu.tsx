import { createContext, Fragment, useContext, useState } from "react"
import { CheckIcon, EllipsisVerticalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// A row's actions are one list, reached from its ⋯ and by right-clicking it, so the two never disagree.
// Groups are drawn with a separator between them; empty groups are dropped.
export interface MenuAction {
  label: string
  // Absent on an item that only opens its submenu
  onSelect?: () => void
  // Runs onSelect once the menu has closed, so the menu doesn't take focus back from what it opens (a
  // rename field, the agent window)
  afterClose?: boolean
  destructive?: boolean
  disabled?: boolean
  // The current choice in a submenu, ticked at the right
  checked?: boolean
  // A small mark before the label (a highlight's colour dot)
  mark?: React.ReactNode
  // A muted line under the label, wrapped: where the work the row acts on stands (Owlit at it, or why it
  // stopped), on the row that stops it or tries it again. working: it shimmers (DESIGN.md, the working
  // rung).
  detail?: string
  working?: boolean
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

const KitContext = createContext<Kit>(dropdownKit)

function renderItem(a: MenuAction, k: Kit) {
  if (a.children)
    return (
      <k.Sub key={a.label}>
        <k.SubTrigger disabled={a.disabled || !a.children.length}>{a.label}</k.SubTrigger>
        <k.SubContent className={a.childrenClassName ?? "w-40"}>{a.children.map((c) => renderItem(c, k))}</k.SubContent>
      </k.Sub>
    )
  const run = a.onSelect
  return (
    <k.Item
      key={a.label}
      variant={a.destructive ? "destructive" : "default"}
      disabled={a.disabled}
      onSelect={run && a.afterClose ? () => setTimeout(run, 0) : run}
    >
      {a.mark}
      {a.detail ? (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{a.label}</span>
          <span className={cn("text-xs text-muted-foreground", a.working && "shimmer")}>{a.detail}</span>
        </span>
      ) : (
        <span className="truncate">{a.label}</span>
      )}
      {a.checked && <CheckIcon className="ml-auto text-muted-foreground" />}
    </k.Item>
  )
}

// The items of either menu. A menu whose groups need hooks (the paper menu) renders this from its own
// component passed as a menu's children: Radix mounts children only while the menu is open, so a list of
// closed rows runs none of them.
export function MenuItems({ groups }: { groups: MenuGroups }) {
  const k = useContext(KitContext)
  return groups
    .filter((g) => g.length)
    .map((group, i) => (
      <Fragment key={i}>
        {i > 0 && <k.Separator />}
        {group.map((a) => renderItem(a, k))}
      </Fragment>
    ))
}

type ContentProps = Omit<React.ComponentProps<typeof DropdownMenuContent>, "children"> &
  ({ groups: MenuGroups; children?: never } | { groups?: never; children: React.ReactNode })

// Focus isn't handed back to the trigger on close: a rename input or the next row may want it
export function ActionsDropdownContent({ groups, children, className, ...props }: ContentProps) {
  return (
    <DropdownMenuContent className={className ?? "w-44"} onCloseAutoFocus={(e) => e.preventDefault()} {...props}>
      <KitContext.Provider value={dropdownKit}>{children ?? <MenuItems groups={groups!} />}</KitContext.Provider>
    </DropdownMenuContent>
  )
}

// Wraps a row so right-clicking it opens its actions where the pointer is. `onOpen` runs as the menu opens
// (the row it was opened on may need to become the selection). `menu` stands in for `groups` when the
// items come from a component of their own (see MenuItems).
export function ActionsOnRightClick({
  groups,
  menu,
  onOpen,
  className,
  children,
}: {
  groups?: MenuGroups
  menu?: React.ReactNode
  onOpen?: () => void
  className?: string
  children: React.ReactNode
}) {
  // Nothing to offer (a row being renamed): the system's own menu, as in any text field
  if (!menu && !groups?.some((g) => g.length)) return children
  return (
    <ContextMenu onOpenChange={(open) => open && onOpen?.()}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className={className ?? "w-44"} onCloseAutoFocus={(e) => e.preventDefault()}>
        <KitContext.Provider value={contextKit}>{menu ?? <MenuItems groups={groups!} />}</KitContext.Provider>
      </ContextMenuContent>
    </ContextMenu>
  )
}

// A row's ⋯: a small square at the row's end that shows while the row (`group/row`) is hovered, holds
// keyboard focus or has this menu up, and darkens on its own hover. "Up" lasts until the menu's fade-out
// ends: hiding the trigger as soon as the menu closes leaves the fading menu anchored to nothing, and it
// jumps to the window's top-left corner. A row's date that gives way to it can hide on
// `group-has-data-menu-up/row`. Nothing in the row moves when it shows: in the row's flow it keeps its
// place while hidden (keepSpace); floating at the row's end, it sits over the title, which fades
// under it (fadeUnderRowMenu).
export function RowMenuButton({
  groups,
  menu,
  label,
  onOpen,
  side,
  align = "end",
  keepSpace,
  className,
  menuClassName,
}: {
  groups?: MenuGroups
  menu?: React.ReactNode
  label: string
  onOpen?: () => void
  side?: "right" | "bottom"
  align?: "start" | "end"
  keepSpace?: boolean
  className?: string
  menuClassName?: string
}) {
  const [up, setUp] = useState(false)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return
        setUp(true)
        onOpen?.()
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          data-menu-up={up || undefined}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/8 hover:text-foreground focus-key:bg-foreground/8 data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground [&_svg]:size-4",
            keepSpace
              ? "invisible flex group-hover/row:visible group-focus-key/row:visible group-has-focus-key/row:visible data-menu-up:visible"
              : "hidden group-hover/row:flex group-focus-key/row:flex group-has-focus-key/row:flex data-menu-up:flex",
            className,
          )}
        >
          <EllipsisVerticalIcon />
        </button>
      </DropdownMenuTrigger>
      {groups ? (
        <ActionsDropdownContent groups={groups} side={side} align={align} className={menuClassName} onCloseAutoFocus={(e) => (e.preventDefault(), setUp(false))} />
      ) : (
        <ActionsDropdownContent side={side} align={align} className={menuClassName} onCloseAutoFocus={(e) => (e.preventDefault(), setUp(false))}>
          {menu}
        </ActionsDropdownContent>
      )}
    </DropdownMenu>
  )
}

// For what a floating RowMenuButton sits over: its end fades out while the ⋯ shows (the
// `fade-under-menu` utility in index.css). It goes on an element that reaches the row's end and carries
// no fill, so the row's own hover fill stays whole.
export const fadeUnderRowMenu =
  "group-hover/row:fade-under-menu group-focus-key/row:fade-under-menu group-has-focus-key/row:fade-under-menu group-has-data-menu-up/row:fade-under-menu"

// A page header's ⋯, the trigger of its DropdownMenu (the menu's content goes beside it): a ghost icon
// button that keeps the `muted` fill while its menu is up
export function MenuButton({ label, className }: { label: string; className?: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label={label} className={cn("text-muted-foreground data-[state=open]:bg-muted", className)}>
        <EllipsisVerticalIcon />
      </Button>
    </DropdownMenuTrigger>
  )
}
