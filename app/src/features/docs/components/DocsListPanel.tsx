import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ChevronRightIcon, EllipsisVerticalIcon, FolderPlusIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { usePaletteStore } from "@/app/palette-store"
import { ActionsDropdownContent, ActionsOnRightClick, type MenuGroups } from "@/components/action-menu"
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { keysFor } from "@/app/shortcuts"
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDocActions } from "../actions"
import { buildTree, type FileNode, type FolderNode, type TreeNode } from "../lib/tree"
import { onDisk, openOnDisk } from "../disk"
import { useDocsStore } from "../store"
import { isWithin, parentPath } from "../types"
import { folderOfKey, rowKey, useDocsUiStore } from "../ui-store"
import { useNewDoc } from "../use-new-doc"

const DRAG_TYPE = "application/x-owlit-docs"
// What a drag carries: the row it started on, or every picked row when it started on one of them
interface DragItems {
  files: string[]
  folders: string[]
}

// How long a closed folder waits under a drag before it opens, so a drop can reach inside it
const SPRING_MS = 600

// Same row look as the Chat list, a little tighter because a tree runs longer. Focus lands on the button
// inside, so the row lights up when it holds keyboard focus. It stays lit while its ⋯ menu or its
// right-click menu is open.
const rowClass =
  "group/row relative flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-hidden transition-colors hover:bg-sidebar-accent has-focus-key:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent data-[state=open]:bg-sidebar-accent"
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 })
// Every row keeps a chevron-wide slot, so names at the same depth line up whether they are folders or files
const Slot = ({ children }: { children?: React.ReactNode }) => <span className="flex size-3.5 shrink-0 items-center justify-center">{children}</span>

// A name cut short by the row shows in full on hover
const fullNameOnHover = (name: string) => (e: React.MouseEvent<HTMLElement>) => {
  const text = e.currentTarget.querySelector<HTMLElement>("[data-name]")
  e.currentTarget.title = text && text.scrollWidth > text.clientWidth ? name : ""
}

// The rows as they show now, top to bottom; which folders are open decides that, so it's read from the page
const visibleRows = (inside: Element | null) => Array.from(inside?.closest("[data-tree]")?.querySelectorAll<HTMLElement>("[data-row-key]") ?? [])

// Puts keyboard focus on a row once it has been drawn (after a rename or a delete)
const focusRow = (key: string) =>
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-tree] [data-row-key="${CSS.escape(key)}"]`)?.focus())

// The row that stands for the user's choice before any ⌘- or ⇧-click: the folder last clicked, else the
// open doc. A first ⌘-click adds to it, as it is already lit.
function currentRow(activeId: string | undefined) {
  const { selectedFolder } = useDocsUiStore.getState()
  if (selectedFolder) return rowKey.folder(selectedFolder)
  return activeId ? rowKey.file(activeId) : null
}

// ⌘-click adds or drops a row, ⇧-click takes the rows between the anchor and this one, a plain click
// drops the picks and does the row's own thing. Returns whether the click was a pick.
function pickOnClick(e: React.MouseEvent<HTMLElement>, key: string, activeId: string | undefined) {
  const ui = useDocsUiStore.getState()
  const current = currentRow(activeId)
  if (e.metaKey || e.ctrlKey) {
    const base = ui.picked.length ? ui.picked : current ? [current] : []
    ui.setPicked(base.includes(key) ? base.filter((k) => k !== key) : [...base, key], key)
    return true
  }
  if (e.shiftKey) {
    const anchor = (ui.picked.length ? ui.pickAnchor : current) ?? key
    ui.setPicked(rangeOf(visibleRows(e.currentTarget), anchor, key), anchor)
    return true
  }
  if (ui.picked.length) ui.setPicked([], null)
  return false
}

function rangeOf(rows: HTMLElement[], from: string, to: string) {
  const keys = rows.map((r) => r.dataset.rowKey!)
  const a = keys.indexOf(from)
  const b = keys.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return keys.slice(Math.min(a, b), Math.max(a, b) + 1)
}

// A row's menu acts on all picked rows when it is one of several picked, else on the row alone (and
// opening it on a row outside the picks drops them)
function usePickedMenu(key: string, own: () => MenuGroups) {
  const { pickedGroups } = useDocActions()
  // How many rows are picked along with this one, so a "Delete 3 items" label stays true
  const together = useDocsUiStore((s) => (s.picked.includes(key) ? s.picked.length : 0))
  return {
    picked: together > 0,
    groups: together > 1 ? pickedGroups(useDocsUiStore.getState().picked) : own(),
    onOpen: () => {
      if (!together) useDocsUiStore.getState().setPicked([], null)
    },
  }
}

function RowMenu({ groups, label, onOpen }: { groups: MenuGroups; label: string; onOpen: () => void }) {
  return (
    <DropdownMenu onOpenChange={(open) => open && onOpen()}>
      <DropdownMenuTrigger asChild>
        {/* A small square that shows on hover and darkens on its own hover, as in the Chat list */}
        <button
          type="button"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-hidden group-hover/row:opacity-100 group-has-focus-key/row:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-key:bg-foreground/8 data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground data-[state=open]:opacity-100"
        >
          <EllipsisVerticalIcon className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <ActionsDropdownContent groups={groups} side="right" align="start" />
    </DropdownMenu>
  )
}

// `byKey`: ended with Enter or Esc, so focus goes back to the row; a blur means the user went elsewhere
function RenameInput({ initial, depth, onDone }: { initial: string; depth: number; onDone: (name: string | null, byKey: boolean) => void }) {
  const [draft, setDraft] = useState(initial)
  // Enter or Esc ends it; the blur that follows as the input goes away must not end it again
  const done = useRef(false)
  const finish = (name: string | null, byKey: boolean) => {
    if (done.current) return
    done.current = true
    onDone(name, byKey)
  }
  return (
    <input
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft, false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(draft, true)
        if (e.key === "Escape") finish(null, true)
      }}
      // The text stays where the name was: past the chevron slot, less the border
      style={{ paddingLeft: indent(depth).paddingLeft + 17 }}
      className="h-8 w-full rounded-md border bg-card pr-2 text-sm outline-none focus-visible:border-foreground/30"
      aria-label="Rename"
    />
  )
}

interface TreeProps {
  activeId?: string
  dragOver: string | null
  setDragOver: (path: string | null) => void
  onDropInto: (folder: string, e: React.DragEvent) => void
}

// Starts a drag of this row, or of every picked row when it is one of them
function dragStart(e: React.DragEvent, key: string) {
  const { picked } = useDocsUiStore.getState()
  const keys = picked.length > 1 && picked.includes(key) ? picked : [key]
  const items: DragItems = { files: [], folders: [] }
  for (const k of keys) {
    const folder = folderOfKey(k)
    if (folder === null) items.files.push(k)
    else items.folders.push(folder)
  }
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(items))
  e.dataTransfer.effectAllowed = "move"
}

function FileRow({ node, depth, ...p }: { node: FileNode; depth: number } & TreeProps) {
  const navigate = useNavigate()
  const { fileGroups } = useDocActions()
  const key = rowKey.file(node.file.id)
  const renaming = useDocsUiStore((s) => s.renaming === key)
  const active = node.file.id === p.activeId
  const menu = usePickedMenu(key, () => fileGroups(node.file))
  // While rows are picked only they are filled, so the open doc doesn't pass for one of them
  const picking = useDocsUiStore((s) => s.picked.length > 0)

  if (renaming)
    return (
      <RenameInput
        initial={node.name}
        depth={depth}
        onDone={(name, byKey) => {
          if (name !== null) useDocsStore.getState().renameFile(node.file.id, name)
          useDocsUiStore.getState().setRenaming(null)
          if (byKey) focusRow(key)
        }}
      />
    )

  const open = () => {
    if (node.markdown) navigate(`/docs/${node.file.id}`)
    else if (onDisk) openOnDisk(node.file.path)
    else toast(`${node.name} opens in the system app`)
  }

  // A drop on a doc lands in the doc's folder, which lights up to say so
  const folder = parentPath(node.file.path)

  return (
    <ActionsOnRightClick groups={menu.groups} onOpen={menu.onOpen}>
      <div
        className={cn(rowClass, ((active && !picking) || menu.picked) && "bg-sidebar-accent", active && "font-medium")}
        style={indent(depth)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          e.stopPropagation()
          p.setDragOver(folder)
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && p.setDragOver(null)}
        onDrop={(e) => {
          e.stopPropagation()
          p.onDropInto(folder, e)
        }}
      >
        <button
          type="button"
          draggable
          data-row-key={key}
          data-path={node.file.path}
          onDragStart={(e) => dragStart(e, key)}
          onClick={(e) => pickOnClick(e, key, p.activeId) || open()}
          onMouseEnter={fullNameOnHover(node.name)}
          className={cn("flex min-w-0 flex-1 items-center gap-1 py-1.5 pr-1 text-left outline-hidden group-hover/row:pr-6", !node.markdown && "text-muted-foreground")}
        >
          <Slot />
          <span data-name className="truncate">
            {node.name}
          </span>
        </button>
        <RowMenu label="Doc actions" groups={menu.groups} onOpen={menu.onOpen} />
      </div>
    </ActionsOnRightClick>
  )
}

function FolderRow({ node, depth, ...p }: { node: FolderNode; depth: number } & TreeProps) {
  const { folderGroups } = useDocActions()
  const key = rowKey.folder(node.path)
  const open = useDocsUiStore((s) => !!s.expanded[node.path])
  const selected = useDocsUiStore((s) => s.selectedFolder === node.path)
  const renaming = useDocsUiStore((s) => s.renaming === key)
  const { setExpanded, selectFolder, setRenaming } = useDocsUiStore.getState()
  const activeInside = useDocsStore((s) => (p.activeId ? s.files[p.activeId]?.path.startsWith(node.path + "/") : false))
  const menu = usePickedMenu(key, () => folderGroups(node.path))
  const picking = useDocsUiStore((s) => s.picked.length > 0)

  // A closed folder held under a drag opens, so the drop can go inside it
  const spring = useRef<number | undefined>(undefined)
  const cancelSpring = () => {
    window.clearTimeout(spring.current)
    spring.current = undefined
  }
  useEffect(() => cancelSpring, [])

  return (
    <>
      {renaming ? (
        <RenameInput
          initial={node.name}
          depth={depth}
          onDone={(name, byKey) => {
            let to = node.path
            if (name !== null) {
              to = useDocsStore.getState().renameFolder(node.path, name)
              if (open) setExpanded(to, true)
              if (selected) selectFolder(to)
            }
            setRenaming(null)
            if (byKey) focusRow(rowKey.folder(to))
          }}
        />
      ) : (
        <ActionsOnRightClick groups={menu.groups} onOpen={menu.onOpen}>
          <div
            className={cn(rowClass, ((selected && !picking) || menu.picked) && "bg-sidebar-accent", p.dragOver === node.path && "bg-foreground/8")}
            style={indent(depth)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
              e.preventDefault()
              e.stopPropagation()
              p.setDragOver(node.path)
              if (!open && spring.current === undefined)
                spring.current = window.setTimeout(() => {
                  spring.current = undefined
                  setExpanded(node.path, true)
                }, SPRING_MS)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              p.setDragOver(null)
              cancelSpring()
            }}
            onDrop={(e) => {
              e.stopPropagation()
              cancelSpring()
              p.onDropInto(node.path, e)
            }}
          >
            <button
              type="button"
              draggable
              data-row-key={key}
              data-path={node.path}
              data-folder=""
              onDragStart={(e) => dragStart(e, key)}
              onClick={(e) => {
                if (pickOnClick(e, key, p.activeId)) return
                setExpanded(node.path, !open)
                selectFolder(node.path)
              }}
              aria-expanded={open}
              onMouseEnter={fullNameOnHover(node.name)}
              className="flex min-w-0 flex-1 items-center gap-1 py-1.5 text-left outline-hidden group-hover/row:pr-6"
            >
              <Slot>
                <ChevronRightIcon className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
              </Slot>
              <span data-name className={cn("truncate", !open && activeInside && "font-medium")}>
                {node.name}
              </span>
            </button>
            <RowMenu label="Folder actions" groups={menu.groups} onOpen={menu.onOpen} />
          </div>
        </ActionsOnRightClick>
      )}
      {open && <TreeLevel nodes={node.children} depth={depth + 1} {...p} />}
    </>
  )
}

function TreeLevel({ nodes, depth, ...p }: { nodes: TreeNode[]; depth: number } & TreeProps) {
  return (
    <>
      {nodes.map((n) =>
        n.kind === "folder" ? <FolderRow key={`f:${n.path}`} node={n} depth={depth} {...p} /> : <FileRow key={n.file.id} node={n} depth={depth} {...p} />,
      )}
    </>
  )
}

// The tree from the keyboard: ↑ ↓ move, → opens a folder or steps into it, ← closes it or steps out,
// ⇧↑ ⇧↓ pick as they move, F2 renames, ⌘⌫ deletes (with Undo), Esc drops the picks. ↵ and space are the
// row button's own.
function useTreeKeys() {
  const { deleteKeys, startRenaming } = useDocActions()
  return (e: React.KeyboardEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-row-key]")
    if (!row) return
    const key = row.dataset.rowKey!
    const rows = visibleRows(row)
    const i = rows.indexOf(row)
    const ui = useDocsUiStore.getState()
    const folder = row.dataset.folder !== undefined ? row.dataset.path! : null

    const move = (to: HTMLElement | undefined) => {
      if (!to) return
      e.preventDefault()
      to.focus()
      if (e.shiftKey) {
        const anchor = (ui.picked.length ? ui.pickAnchor : key) ?? key
        ui.setPicked(rangeOf(rows, anchor, to.dataset.rowKey!), anchor)
      } else if (ui.picked.length) ui.setPicked([], null)
    }

    if (e.key === "ArrowDown") return move(rows[i + 1])
    if (e.key === "ArrowUp") return move(rows[i - 1])
    if (e.key === "Home") return move(rows[0])
    if (e.key === "End") return move(rows[rows.length - 1])
    if (e.key === "ArrowRight" && folder !== null) {
      e.preventDefault()
      if (!ui.expanded[folder]) ui.setExpanded(folder, true)
      else if (rows[i + 1] && parentPath(rows[i + 1].dataset.path!) === folder) rows[i + 1].focus()
      return
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      if (folder !== null && ui.expanded[folder]) return ui.setExpanded(folder, false)
      const parent = parentPath(row.dataset.path!)
      if (parent) rows.find((r) => r.dataset.rowKey === rowKey.folder(parent))?.focus()
      return
    }
    if (e.key === "F2") {
      e.preventDefault()
      return startRenaming(key)
    }
    if (e.key === "Backspace" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      const keys = ui.picked.length > 1 && ui.picked.includes(key) ? ui.picked : [key]
      // Focus goes to the nearest row that stays: below first, else above
      const gone = keys.map((k) => folderOfKey(k) ?? useDocsStore.getState().files[k]?.path).filter((p): p is string => !!p)
      const stays = (r: HTMLElement) => !gone.some((g) => isWithin(r.dataset.path!, g))
      const next = rows.slice(i + 1).find(stays) ?? rows.slice(0, i).reverse().find(stays)
      deleteKeys(keys)
      if (next) focusRow(next.dataset.rowKey!)
      return
    }
    if (e.key === "Escape" && ui.picked.length) {
      e.preventDefault()
      ui.setPicked([], null)
    }
  }
}

// Second-column content for Docs: search, new doc, and the workspace folder as a tree
export function DocsListPanel() {
  const { docId } = useParams()
  const files = useDocsStore((s) => s.files)
  const folders = useDocsStore((s) => s.folders)
  const { expandTo, selectFolder } = useDocsUiStore.getState()
  const openPalette = usePaletteStore((s) => s.setOpen)
  const newDoc = useNewDoc()
  const { startRenaming } = useDocActions()
  const onKeyDown = useTreeKeys()
  const [dragOver, setDragOver] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(Object.values(files), folders), [files, folders])

  // Moves what was dragged into a folder ("" is the workspace root). What sits inside a dragged folder
  // goes with it, and a folder never goes inside itself.
  const onDropInto = (folder: string, e: React.DragEvent) => {
    setDragOver(null)
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return
    e.preventDefault()
    const items = JSON.parse(raw) as DragItems
    const store = useDocsStore.getState()
    const ui = useDocsUiStore.getState()
    const top = items.folders.filter((f) => !items.folders.some((o) => o !== f && isWithin(f, o)))
    for (const path of top) {
      if (isWithin(folder, path)) continue
      const wasOpen = ui.expanded[path]
      const to = store.moveFolder(path, folder)
      if (wasOpen) ui.setExpanded(to, true)
    }
    for (const id of items.files) {
      const file = useDocsStore.getState().files[id]
      if (file && !top.some((f) => isWithin(file.path, f))) store.moveFile(id, folder)
    }
    if (items.files.length + items.folders.length > 1) ui.setPicked([], null)
    if (folder) expandTo(folder)
  }

  const newFolder = () => startRenaming(rowKey.folder(useDocsStore.getState().createFolder("")))

  const props: TreeProps = { activeId: docId, dragOver, setDragOver, onDropInto }

  return (
    <>
      <SidebarHeader className="gap-1.5 px-2.5 pt-2.5 pb-1">
        {/* Looks like a search field, opens the ⌘K palette, as in Chat; it finds docs by their text too */}
        <button
          type="button"
          onClick={() => openPalette(true)}
          className="flex h-9 w-full items-center gap-2.5 rounded-md border border-border/70 bg-card px-3 text-sm text-muted-foreground outline-none transition-colors hover:border-border hover:text-foreground focus-key:border-foreground/30 focus-key:text-foreground"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Search</span>
          <Kbd className="bg-transparent">{keysFor("palette")}</Kbd>
        </button>
        <div className="group/new relative mt-1.5 flex items-center">
          <button
            type="button"
            onClick={() => newDoc()}
            className="flex h-9 w-full items-center gap-2 rounded-md pr-2.5 pl-1.5 text-sm outline-hidden transition-colors hover:bg-sidebar-accent focus-key:bg-sidebar-accent"
          >
            {/* Drawn exactly like New chat, so switching between Chat and Docs moves nothing */}
            <span className="grid size-5 place-items-center">
              <span className="flex size-4.5 items-center justify-center rounded-full bg-foreground/8">
                <PlusIcon className="size-3" />
              </span>
            </span>
            <span className="flex-1 text-left">New doc</span>
            <Kbd className="mr-7 bg-transparent opacity-0 transition-opacity group-hover/new:opacity-100">{keysFor("new")}</Kbd>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="New folder"
                onClick={newFolder}
                className="absolute right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/new:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-key:opacity-100"
              >
                <FolderPlusIcon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">New folder</TooltipContent>
          </Tooltip>
        </div>
      </SidebarHeader>
      {/* Right-clicking the space around the rows makes something at the workspace root; a row's own menu
          takes the right-clicks on it */}
      <ActionsOnRightClick
        groups={[
          [
            { label: "New doc", onSelect: () => newDoc("") },
            { label: "New folder", onSelect: newFolder },
          ],
        ]}
      >
        <SidebarContent
          data-tree
          // 2px between rows, so two filled rows side by side (open doc, clicked folder, hover) stay apart
          className={cn("gap-0.5 px-2.5 pt-3 pb-4", dragOver === "" && "bg-foreground/[0.03]")}
          // Clicking empty space puts new docs back at the workspace root and drops the picks
          onClick={(e) => {
            if (e.target !== e.currentTarget) return
            selectFolder("")
            useDocsUiStore.getState().setPicked([], null)
          }}
          onKeyDown={onKeyDown}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            setDragOver("")
          }}
          onDragLeave={(e) => e.target === e.currentTarget && setDragOver(null)}
          onDrop={(e) => onDropInto("", e)}
        >
          {tree.children.length === 0 && <div className="px-2.5 py-2 text-sm text-muted-foreground">No docs yet.</div>}
          <TreeLevel nodes={tree.children} depth={0} {...props} />
        </SidebarContent>
      </ActionsOnRightClick>
    </>
  )
}
