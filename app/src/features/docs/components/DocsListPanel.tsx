import { t } from "@lingui/core/macro"
import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { FolderPlusIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ActionsOnRightClick } from "@/components/action-menu"
import { NoteDot } from "@/components/marks"
import { FoldChevron } from "@/components/fold"
import { NewRow, PanelEmpty, PanelHeader } from "@/components/list-panel"
import { SidebarContent } from "@/components/ui/sidebar"
import { Tip } from "@/components/tip"
import { useDocActions } from "../actions"
import { buildTree, type FileNode, type FolderNode, type TreeNode } from "../lib/tree"
import { onDisk, openOnDisk } from "../disk"
import { useGoingThrough, useNewOwlitComments } from "../owlit"
import { useDocsStore } from "../store"
import { useShareStore } from "../share/store"
import { parentPath } from "../types"
import { rowKey, useDocsUiStore } from "../ui-store"
import { useNewDoc } from "../use-new-doc"
import { carriesRows, droppedRows, moveInto } from "./tree/drag"
import { focusRow } from "./tree/picking"
import { TreeRename, TreeRow, type TreeProps } from "./tree/TreeRow"
import { useTreeKeys } from "./tree/use-tree-keys"

// How long a closed folder waits under a drag before it opens, so a drop can reach inside it
const SPRING_MS = 600

function FileRow({ node, depth, ...p }: { node: FileNode; depth: number } & TreeProps) {
  const navigate = useNavigate()
  const { fileGroups } = useDocActions()
  const key = rowKey.file(node.file.id)
  const renaming = useDocsUiStore((s) => s.renaming === key)
  const active = node.file.id === p.activeId
  const shared = useShareStore((s) => !!s.byPath[node.file.path])
  // Owlit left comments here the user hasn't seen (its chip on the doc carries the same dot)
  const fresh = useNewOwlitComments(node.file).length > 0
  // The row's menu is built as it draws, and says where Owlit going through the doc stands
  useGoingThrough(node.file.path)

  if (renaming)
    return (
      <TreeRename
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
    else {
      const name = node.name
      toast(t`${name} opens in the system app`)
    }
  }

  return (
    <TreeRow
      rowKey={key}
      path={node.file.path}
      name={node.name}
      depth={depth}
      tree={p}
      lit={active}
      menuLabel={t`Doc actions`}
      menu={() => fileGroups(node.file)}
      // A drop on a doc lands in the doc's folder, which lights up to say so
      dropTo={parentPath(node.file.path)}
      onOpen={open}
      trail={
        fresh || shared ? (
          <>
            {fresh && <NoteDot label={t`Owlit commented since you last looked`} />}
            {shared && <UsersIcon className="size-3" role="img" aria-hidden={false} aria-label={t`Shared by link`} />}
          </>
        ) : undefined
      }
      className={cn(active && "font-medium")}
      buttonClassName={cn("pr-1", !node.markdown && "text-muted-foreground")}
    />
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
        <TreeRename
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
        <TreeRow
          rowKey={key}
          path={node.path}
          name={node.name}
          depth={depth}
          tree={p}
          lit={selected}
          menuLabel={t`Folder actions`}
          menu={() => folderGroups(node.path)}
          dropTo={node.path}
          expanded={open}
          lead={<FoldChevron open={open} className="text-muted-foreground" />}
          onOpen={() => {
            setExpanded(node.path, !open)
            selectFolder(node.path)
          }}
          onDragHold={() => {
            if (!open && spring.current === undefined)
              spring.current = window.setTimeout(() => {
                spring.current = undefined
                setExpanded(node.path, true)
              }, SPRING_MS)
          }}
          onDragGone={cancelSpring}
          className={cn(p.dragOver === node.path && "bg-foreground/8")}
          nameClassName={cn(!open && activeInside && "font-medium")}
        />
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
  const { selectFolder } = useDocsUiStore.getState()
  const newDoc = useNewDoc()
  const { startRenaming } = useDocActions()
  const onKeyDown = useTreeKeys()
  const [dragOver, setDragOver] = useState<string | null>(null)

  const tree = useMemo(() => buildTree(Object.values(files), folders), [files, folders])

  // Moves what was dragged into a folder ("" is the workspace root)
  const onDropInto = (folder: string, e: React.DragEvent) => {
    setDragOver(null)
    const keys = droppedRows(e)
    if (!keys) return
    e.preventDefault()
    moveInto(folder, keys)
  }

  const newFolder = () => startRenaming(rowKey.folder(useDocsStore.getState().createFolder("")))

  const props: TreeProps = { activeId: docId, dragOver, setDragOver, onDropInto }

  return (
    <>
      <PanelHeader>
        <NewRow
          label={t`New doc`}
          onClick={() => newDoc()}
          extra={
            <Tip label={t`New folder`} side="right">
              <button
                type="button"
                aria-label={t`New folder`}
                onClick={newFolder}
                className="absolute right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/new:opacity-100 hover:bg-foreground/8 hover:text-foreground focus-key:opacity-100"
              >
                <FolderPlusIcon className="size-4" />
              </button>
            </Tip>
          }
        />
      </PanelHeader>
      {/* Right-clicking the space around the rows makes something at the workspace root; a row's own menu
          takes the right-clicks on it */}
      <ActionsOnRightClick
        groups={[
          [
            { label: t`New doc`, onSelect: () => newDoc("") },
            { label: t`New folder`, onSelect: newFolder },
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
            if (!carriesRows(e)) return
            e.preventDefault()
            setDragOver("")
          }}
          onDragLeave={(e) => e.target === e.currentTarget && setDragOver(null)}
          onDrop={(e) => onDropInto("", e)}
        >
          {tree.children.length === 0 && <PanelEmpty>{t`No docs yet.`}</PanelEmpty>}
          <TreeLevel nodes={tree.children} depth={0} {...props} />
        </SidebarContent>
      </ActionsOnRightClick>
    </>
  )
}
