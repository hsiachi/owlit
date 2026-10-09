import { baseName, displayName, isMarkdown, parentPath, type WorkspaceFile } from "../types"

export interface FolderNode {
  kind: "folder"
  path: string
  name: string
  modifiedAt: number
  children: TreeNode[]
}

export interface FileNode {
  kind: "file"
  file: WorkspaceFile
  name: string
  markdown: boolean
}

export type TreeNode = FolderNode | FileNode

// The workspace's paper library, Owlit's Knowledge and dot-folders are not docs
export const isHidden = (path: string) => /^(library|knowledge)(\/|$)/.test(path) || path.split("/").some((p) => p.startsWith("."))

// Folders first, then files; each by last edit, newest first. A folder's time is its newest file's.
export function buildTree(files: WorkspaceFile[], folders: string[]): FolderNode {
  const root: FolderNode = { kind: "folder", path: "", name: "", modifiedAt: 0, children: [] }
  const byPath = new Map<string, FolderNode>([["", root]])

  const folder = (path: string): FolderNode => {
    const hit = byPath.get(path)
    if (hit) return hit
    const node: FolderNode = { kind: "folder", path, name: baseName(path), modifiedAt: 0, children: [] }
    byPath.set(path, node)
    folder(parentPath(path)).children.push(node)
    return node
  }

  for (const f of folders) if (!isHidden(f)) folder(f)

  for (const file of files) {
    if (isHidden(file.path)) continue
    folder(parentPath(file.path)).children.push({ kind: "file", file, name: displayName(file.path), markdown: isMarkdown(file.path) })
    // The edit time bubbles up so busy folders rise
    for (let p = parentPath(file.path); ; p = parentPath(p)) {
      const node = folder(p)
      node.modifiedAt = Math.max(node.modifiedAt, file.modifiedAt)
      if (!p) break
    }
  }

  const sort = (node: FolderNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
      const ta = a.kind === "folder" ? a.modifiedAt : a.file.modifiedAt
      const tb = b.kind === "folder" ? b.modifiedAt : b.file.modifiedAt
      return tb - ta || a.name.localeCompare(b.name)
    })
    for (const c of node.children) if (c.kind === "folder") sort(c)
  }
  sort(root)
  return root
}
