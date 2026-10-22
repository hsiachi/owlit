import { t } from "@lingui/core/macro"
import type { ThreadRead } from "@owlit/protocol"
import type { MenuGroups } from "@/components/action-menu"
import { shown } from "../lib"
import { deleteThread } from "../store"
import { useNavigate } from "react-router-dom"
import { downloadCsv, exportAsDoc } from "../export"

// One thread's actions, the same from its row's ⋯, a right-click and the page's ⋯. What the thread says
// is Owlit's and changes when the user asks in a chat; what is here is the person's: taking it out of the
// app, deleting it.
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
