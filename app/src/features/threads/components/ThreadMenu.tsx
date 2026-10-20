import { t } from "@lingui/core/macro"
import type { ThreadRead } from "@owlit/protocol"
import { useMemo } from "react"
import { useDocsStore } from "@/features/docs/store"
import type { MenuGroups } from "@/components/action-menu"
import { shown } from "../lib"
import { deleteThread, editThread } from "../store"
import { useNavigate } from "react-router-dom"
import { downloadCsv, exportAsDoc } from "../export"

// The workspace's top-level folders, which are its projects. A page works them out once and hands them to
// each thread's menu, rather than every row walking the docs.
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

// One thread's actions, the same from its row's ⋯, a right-click and the page's ⋯
export function useThreadMenu(c: ThreadRead | undefined, projects: string[], opts: { afterDelete?: () => void } = {}): MenuGroups {
  const navigate = useNavigate()
  if (!c) return []
  return [
    [
      {
        label: t`Move to project`,
        childrenClassName: "w-52",
        children: [
          ...projects.map((p) => ({ label: p, checked: c.project === p, onSelect: () => void editThread(c.id, { op: "project", project: p }) })),
          { label: t({ message: "No project", comment: "a thread that belongs to no project folder" }), checked: !c.project, onSelect: () => void editThread(c.id, { op: "project", project: "" }) },
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
          void deleteThread(c.id)
          opts.afterDelete?.()
        },
      },
    ],
  ]
}
