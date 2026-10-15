import { t } from "@lingui/core/macro"
import type { Collection } from "@owlit/protocol"
import { useMemo } from "react"
import { useDocsStore } from "@/features/docs/store"
import type { MenuGroups } from "@/components/action-menu"
import { shown } from "../lib"
import { deleteCollection, editCollection } from "../store"
import { useCollectionsUi } from "../ui-store"
import { useNavigate } from "react-router-dom"
import { downloadCsv, exportAsDoc } from "../export"

// The workspace's top-level folders, which are its projects. A page works them out once and hands them to
// each collection's menu, rather than every row walking the docs.
export function useProjects(): string[] {
  const files = useDocsStore((s) => s.files)
  const folders = useDocsStore((s) => s.folders)
  return useMemo(() => {
    const top = new Set<string>()
    for (const f of Object.values(files)) if (f.path.includes("/")) top.add(f.path.split("/")[0]!)
    for (const f of folders) top.add(f.split("/")[0]!)
    return [...top].filter((p) => !p.startsWith(".") && p !== "library").sort((a, b) => a.localeCompare(b))
  }, [files, folders])
}

// One collection's actions, the same from its row's ⋯, a right-click and the page's ⋯
export function useCollectionMenu(c: Collection | undefined, projects: string[], opts: { afterDelete?: () => void } = {}): MenuGroups {
  const navigate = useNavigate()
  if (!c) return []
  const rename = useCollectionsUi.getState().set
  return [
    [
      { label: t`Rename`, onSelect: () => rename({ renaming: c.id }), afterClose: true },
      {
        label: t({ message: "Watch for new papers", comment: "menu switch: Owlit looks for new papers on this collection's question now and then" }),
        checked: c.watch,
        onSelect: () => void editCollection(c.id, { op: "watch", on: !c.watch }),
      },
      {
        label: t`Move to project`,
        childrenClassName: "w-52",
        children: [
          ...projects.map((p) => ({ label: p, checked: c.project === p, onSelect: () => void editCollection(c.id, { op: "project", project: p }) })),
          { label: t({ message: "No project", comment: "a collection that belongs to no project folder" }), checked: !c.project, onSelect: () => void editCollection(c.id, { op: "project", project: "" }) },
        ],
      },
    ],
    [
      { label: t`Export as a doc`, onSelect: () => exportAsDoc(shown(c), navigate) },
      { label: t`Export as CSV`, onSelect: () => downloadCsv(shown(c)) },
    ],
    [
      {
        label: t`Delete`,
        destructive: true,
        onSelect: () => {
          void deleteCollection(c.id)
          opts.afterDelete?.()
        },
      },
    ],
  ]
}
