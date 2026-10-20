import { t } from "@lingui/core/macro"
import type { ThreadRead } from "@owlit/protocol"
import { useMemo } from "react"
import { useDocsStore } from "@/features/docs/store"
import type { MenuGroups } from "@/components/action-menu"
import { shown } from "../lib"
import { deleteThread } from "../store"
import { useNavigate } from "react-router-dom"
import { downloadCsv, exportAsDoc } from "../export"

// The workspace's top-level folders, which are its projects
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

// One thread's actions, the same from its row's ⋯, a right-click and the page's ⋯. The thread is Owlit's
// and changes when the user asks in a chat, so all there is here is taking it out of the app or deleting it.
export function useThreadMenu(c: ThreadRead | undefined, opts: { afterDelete?: () => void } = {}): MenuGroups {
  const navigate = useNavigate()
  if (!c) return []
  return [
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
