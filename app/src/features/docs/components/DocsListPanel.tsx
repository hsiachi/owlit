import { useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ChevronRightIcon, EllipsisVerticalIcon, FolderPlusIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { usePaletteStore } from "@/app/palette-store"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { keysFor } from "@/app/shortcuts"
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { buildTree, type FileNode, type FolderNode, type TreeNode } from "../lib/tree"
import { onDisk, openOnDisk } from "../disk"
import { useDocsStore, type Removed } from "../store"
import { useDocsUiStore } from "../ui-store"
import { useNewDoc } from "../use-new-doc"

const DRAG_TYPE = "application/x-owlit-docs"
type DragItem = { kind: "file"; id: string } | { kind: "folder"; path: string }

// Same row look as the Chat list, a little tighter because a tree runs longer. Focus lands on the button
// inside, so the row lights up when it holds keyboard focus.
const rowClass =
  "group/row relative flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-sm outline-hidden transition-colors hover:bg-sidebar-accent has-focus-key:bg-sidebar-accent has-[[data-state=open]]:bg-sidebar-accent"
const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 })
// Every row keeps a chevron-wide slot, so names at the same depth line up whether they are folders or files
const Slot = ({ children }: { children?: React.ReactNode }) => <span className="flex size-3.5 shrink-0 items-center justify-center">{children}</span>

// A name cut short by the row shows in full on hover
const fullNameOnHover = (name: string) => (e: React.MouseEvent<HTMLElement>) => {
  const text = e.currentTarget.querySelector<HTMLElement>("[data-name]")
  e.currentTarget.title = text && text.scrollWidth > text.clientWidth ? name : ""
}

function undoToast(title: string, name: string, removed: Removed) {
  toast(title, {
    description: name,
    action: { label: "Undo", onClick: () => useDocsStore.getState().restore(removed) },
  })
}

function RowMenu({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <DropdownMenu>
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
      <DropdownMenuContent side="right" align="start" className="w-44" onCloseAutoFocus={(e) => e.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RenameInput({ initial, depth, onDone }: { initial: string; depth: number; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(initial)
  // Enter or Esc ends it; the blur that follows as the input goes away must not end it again
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(draft)
        if (e.key === "Escape") finish(null)
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

function FileRow({ node, depth, ...p }: { node: FileNode; depth: number } & TreeProps) {
  const navigate = useNavigate()
  const { renameFile, deleteFile } = useDocsStore.getState()
  const renaming = useDocsUiStore((s) => s.renaming === node.file.id)
  const setRenaming = useDocsUiStore((s) => s.setRenaming)
  const active = node.file.id === p.activeId

  if (renaming)
    return (
      <RenameInput
        initial={node.name}
        depth={depth}
        onDone={(name) => {
          if (name !== null) renameFile(node.file.id, name)
          setRenaming(null)
        }}
      />
    )

  const open = () => {
    if (node.markdown) navigate(`/docs/${node.file.id}`)
    else if (onDisk) openOnDisk(node.file.path)
    else toast(`${node.name} opens in the system app`)
  }

  return (
    <div className={cn(rowClass, active && "bg-sidebar-accent font-medium")} style={indent(depth)}>
      <button
        type="button"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: "file", id: node.file.id } satisfies DragItem))
          e.dataTransfer.effectAllowed = "move"
        }}
        onClick={open}
        onMouseEnter={fullNameOnHover(node.name)}
        className={cn("flex min-w-0 flex-1 items-center gap-1 py-1.5 pr-1 text-left outline-hidden group-hover/row:pr-6", !node.markdown && "text-muted-foreground")}
      >
        <Slot />
        <span data-name className="truncate">
          {node.name}
        </span>
      </button>
      <RowMenu label="Doc actions">
        <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(node.file.id), 0)}>Rename</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            const removed = deleteFile(node.file.id)
            if (active) navigate("/docs", { replace: true })
            undoToast("Doc deleted", node.name, removed)
          }}
        >
          Delete
        </DropdownMenuItem>
      </RowMenu>
    </div>
  )
}

function FolderRow({ node, depth, ...p }: { node: FolderNode; depth: number } & TreeProps) {
  const navigate = useNavigate()
  const newDoc = useNewDoc()
  const { createFolder, renameFolder, deleteFolder } = useDocsStore.getState()
  const open = useDocsUiStore((s) => !!s.expanded[node.path])
  const selected = useDocsUiStore((s) => s.selectedFolder === node.path)
  const renaming = useDocsUiStore((s) => s.renaming === `folder:${node.path}`)
  const { setExpanded, expandTo, selectFolder, setRenaming } = useDocsUiStore.getState()
  const activeInside = useDocsStore((s) => (p.activeId ? s.files[p.activeId]?.path.startsWith(node.path + "/") : false))

  return (
    <>
      {renaming ? (
        <RenameInput
          initial={node.name}
          depth={depth}
          onDone={(name) => {
            if (name !== null) {
              const to = renameFolder(node.path, name)
              if (open) setExpanded(to, true)
              if (selected) selectFolder(to)
            }
            setRenaming(null)
          }}
        />
      ) : (
        <div
          className={cn(rowClass, selected && "bg-sidebar-accent", p.dragOver === node.path && "bg-foreground/8")}
          style={indent(depth)}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
            e.preventDefault()
            e.stopPropagation()
            p.setDragOver(node.path)
          }}
          onDragLeave={() => p.setDragOver(null)}
          onDrop={(e) => {
            e.stopPropagation()
            p.onDropInto(node.path, e)
          }}
        >
          <button
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: "folder", path: node.path } satisfies DragItem))
              e.dataTransfer.effectAllowed = "move"
            }}
            onClick={() => {
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
          <RowMenu label="Folder actions">
            <DropdownMenuItem
              onSelect={() => {
                expandTo(node.path)
                newDoc(node.path)
              }}
            >
              New doc
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const path = createFolder(node.path)
                expandTo(node.path)
                setTimeout(() => setRenaming(`folder:${path}`), 0)
              }}
            >
              New folder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(`folder:${node.path}`), 0)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                const removed = deleteFolder(node.path)
                if (activeInside) navigate("/docs", { replace: true })
                if (selected) selectFolder(null)
                const n = removed.files.length
                undoToast("Folder deleted", n ? `${node.name} and ${n} ${n === 1 ? "file" : "files"}` : node.name, removed)
              }}
            >
              Delete
            </DropdownMenuItem>
          </RowMenu>
        </div>
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

// Second-column content for Docs: search, new doc, and the workspace folder as a tree
export function DocsListPanel() {
  const { docId } = useParams()
  const files = useDocsStore((s) => s.files)
  const folders = useDocsStore((s) => s.folders)
  const { expandTo, selectFolder, setRenaming } = useDocsUiStore.getState()
  const openPalette = usePaletteStore((s) => s.setOpen)
  const newDoc = useNewDoc()
  const [dragOver, setDragOver] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(Object.values(files), folders), [files, folders])

  const onDropInto = (folder: string, e: React.DragEvent) => {
    setDragOver(null)
    const raw = e.dataTransfer.getData(DRAG_TYPE)
    if (!raw) return
    e.preventDefault()
    const item = JSON.parse(raw) as DragItem
    const store = useDocsStore.getState()
    if (item.kind === "file") store.moveFile(item.id, folder)
    else {
      const ui = useDocsUiStore.getState()
      const wasOpen = ui.expanded[item.path]
      const to = store.moveFolder(item.path, folder)
      if (wasOpen) ui.setExpanded(to, true)
    }
    if (folder) expandTo(folder)
  }

  const newFolder = () => {
    const path = useDocsStore.getState().createFolder("")
    setTimeout(() => setRenaming(`folder:${path}`), 0)
  }

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
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm outline-hidden transition-colors hover:bg-sidebar-accent focus-key:bg-sidebar-accent"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-foreground/8">
              <PlusIcon className="size-3.5" />
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
      <SidebarContent
        // 2px between rows, so two filled rows side by side (open doc, clicked folder, hover) stay apart
        className={cn("gap-0.5 px-2.5 pt-3 pb-4", dragOver === "" && "bg-foreground/[0.03]")}
        // Clicking empty space puts new docs back at the workspace root
        onClick={(e) => e.target === e.currentTarget && selectFolder("")}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          setDragOver("")
        }}
        onDragLeave={(e) => e.target === e.currentTarget && setDragOver(null)}
        onDrop={(e) => onDropInto("", e)}
      >
        {tree.children.length === 0 && (
          <div className="px-2.5 py-2 text-sm text-muted-foreground">No docs yet.</div>
        )}
        <TreeLevel nodes={tree.children} depth={0} {...props} />
      </SidebarContent>
    </>
  )
}
