import { cn } from "@/lib/utils"
import { ActionsOnRightClick, fadeUnderRowMenu, RowMenuButton, type MenuGroups } from "@/components/action-menu"
import { RenameInput } from "@/components/rename-input"
import { useDocActions } from "../../actions"
import { useDocsUiStore } from "../../ui-store"
import { carriesRows, dragStart } from "./drag"
import { pickOnClick } from "./picking"

// What every row of the tree needs from the panel: the open doc, and where a drag would drop
export interface TreeProps {
  activeId?: string
  dragOver: string | null
  setDragOver: (path: string | null) => void
  onDropInto: (folder: string, e: React.DragEvent) => void
}

// Same row look as the Chat list, a little tighter because a tree runs longer. Focus lands on the button
// inside, so the row lights up when it holds keyboard focus. It stays lit while its ⋯ menu or its
// right-click menu is open.
const rowClass =
  "group/row relative flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-hidden transition-colors hover:bg-sidebar-accent has-focus-key:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 })

// A name cut short by the row shows in full on hover
const fullNameOnHover = (name: string) => (e: React.MouseEvent<HTMLElement>) => {
  const text = e.currentTarget.querySelector<HTMLElement>("[data-name]")
  e.currentTarget.title = text && text.scrollWidth > text.clientWidth ? name : ""
}

// A row's menu acts on all picked rows when it is one of several picked, else on the row alone (and
// opening it on a row outside the picks drops them)
function usePickedMenu(key: string, own: () => MenuGroups) {
  const { pickedGroups } = useDocActions()
  // How many rows are picked along with this one, so a "Delete 3 items" label stays true
  const together = useDocsUiStore((s) => (s.picked.includes(key) ? s.picked.length : 0))
  return {
    picked: together > 0,
    groups: together > 1 ? pickedGroups(useDocsUiStore.getState().actingOn(key)) : own(),
    onOpen: () => {
      if (!together) useDocsUiStore.getState().setPicked([], null)
    },
  }
}

// One row of the tree, a doc's or a folder's: picked with ⌘ and ⇧, dragged, dropped on, with its ⋯ and
// right-click menu. A drop on it lands in `dropTo`; `expanded` is said by folder rows only.
export function TreeRow({
  rowKey: key,
  path,
  name,
  depth,
  tree,
  lit,
  menuLabel,
  menu: own,
  dropTo,
  expanded,
  lead,
  trail,
  onOpen,
  onDragHold,
  onDragGone,
  className,
  buttonClassName,
  nameClassName,
}: {
  rowKey: string
  path: string
  name: string
  depth: number
  tree: TreeProps
  // Filled while it is the open doc or the folder last clicked, unless other rows are picked
  lit: boolean
  menuLabel: string
  menu: () => MenuGroups
  dropTo: string
  expanded?: boolean
  // What goes in the chevron-wide slot before the name
  lead?: React.ReactNode
  // A quiet mark after the name (a doc shared by link); it gives way to ⋯ on hover
  trail?: React.ReactNode
  onOpen: () => void
  // While a drag is held over the row, and once it leaves or drops
  onDragHold?: () => void
  onDragGone?: () => void
  className?: string
  buttonClassName?: string
  nameClassName?: string
}) {
  const menu = usePickedMenu(key, own)
  // While rows are picked only they are filled, so the open doc doesn't pass for one of them
  const picking = useDocsUiStore((s) => s.picked.length > 0)
  return (
    // Wide enough for its longest item, "Go through this with Owlit", in both languages
    <ActionsOnRightClick groups={menu.groups} onOpen={menu.onOpen} className="w-56">
      <div
        className={cn(rowClass, ((lit && !picking) || menu.picked) && "bg-sidebar-accent", className)}
        style={indent(depth)}
        onDragOver={(e) => {
          if (!carriesRows(e)) return
          e.preventDefault()
          e.stopPropagation()
          tree.setDragOver(dropTo)
          onDragHold?.()
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          tree.setDragOver(null)
          onDragGone?.()
        }}
        onDrop={(e) => {
          e.stopPropagation()
          onDragGone?.()
          tree.onDropInto(dropTo, e)
        }}
      >
        <button
          type="button"
          draggable
          data-row-key={key}
          data-path={path}
          data-folder={expanded === undefined ? undefined : ""}
          aria-expanded={expanded}
          onDragStart={(e) => dragStart(e, key)}
          onClick={(e) => pickOnClick(e, key, tree.activeId) || onOpen()}
          onMouseEnter={fullNameOnHover(name)}
          // The ⋯ floats over the row's end, where the name fades under it, so nothing makes room for it
          className={cn("flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left outline-hidden", fadeUnderRowMenu, buttonClassName)}
        >
          {/* Every row keeps a chevron-wide slot, so names at the same depth line up whether they are folders or files */}
          <span className="flex size-3.5 shrink-0 items-center justify-center">{lead}</span>
          <span data-name className={cn("truncate", nameClassName)}>
            {name}
          </span>
          {/* It keeps its room while the ⋯ shows in its place, so a long name doesn't grow into it */}
          {trail && (
            <span className="ml-auto flex shrink-0 items-center pl-1 text-muted-foreground group-hover/row:invisible group-focus-key/row:invisible group-has-focus-key/row:invisible group-has-data-menu-up/row:invisible">
              {trail}
            </span>
          )}
        </button>
        <RowMenuButton groups={menu.groups} label={menuLabel} onOpen={menu.onOpen} side="right" align="start" className="absolute top-1/2 right-1 -translate-y-1/2" menuClassName="w-56" />
      </div>
    </ActionsOnRightClick>
  )
}

// The text stays where the name was: past the chevron slot, less the border
export function TreeRename({ initial, depth, onDone }: { initial: string; depth: number; onDone: (name: string | null, byKey: boolean) => void }) {
  return <RenameInput initial={initial} onDone={onDone} style={{ paddingLeft: indent(depth).paddingLeft + 17 }} className="h-8 pr-2" />
}
