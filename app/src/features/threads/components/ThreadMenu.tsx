import { t } from "@lingui/core/macro"
import type { Project, ThreadRead } from "@owlit/protocol"
import type { MenuGroups } from "@/components/action-menu"
import { projectChoices } from "@/features/projects/store"
import { shown } from "../lib"
import { deleteThread, moveThread } from "../store"
import { useNavigate } from "react-router-dom"
import { downloadCsv, exportAsDoc } from "../export"

// One thread's actions, the same from its row's ⋯, a right-click and the page's ⋯. What the thread says
// is Owlit's and changes when the user asks in a chat; what is here is the person's: which project it is
// filed under (one of the workspace's marked projects, useProjects), taking it out of the app, deleting it.
export function useThreadMenu(c: ThreadRead | undefined, projects: Project[], opts: { afterDelete?: () => void } = {}): MenuGroups {
  const navigate = useNavigate()
  if (!c) return []
  return [
    [
      {
        label: t`Move to project`,
        // As wide as the longest project's name up to a limit, so a name reads whole rather than cut
        childrenClassName: "w-max min-w-52 max-w-80",
        children: [
          ...projectChoices(projects).map(({ project: p, label }) => ({ label, checked: c.project === p.path, onSelect: () => void moveThread(c.id, p.path, p.name) })),
          { label: t({ message: "No project", comment: "a thread that belongs to no project" }), checked: !projects.some((p) => p.path === c.project), onSelect: () => void moveThread(c.id, "") },
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
