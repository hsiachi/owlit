import { t } from "@lingui/core/macro"
import { isTaskFinished } from "@owlit/protocol"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { rpc } from "@/lib/rpc"
import { useTasksStore } from "@/features/tasks/store"
import { useLibraryStore } from "./store"

// Papers owlit couldn't get alone, got from the user's own browser one at a time by core's
// papers.fromBrowser run. Started from the paper's card, Home's Waiting on you, or the
// Library under Needs you; each of them shows the same run.

// The run, while it goes on: its progress (done of total), and waiting_for_you once two PDFs in a row
// didn't come
export const useFromBrowserRun = () =>
  useTasksStore((s) => Object.values(s.byId).find((task) => task.kind === "papers.fromBrowser" && !isTaskFinished(task)))

// Papers without a PDF waiting for the user's browser and not under way there, the longest waiting first
export const useWaitingForBrowser = () =>
  useLibraryStore(
    useShallow((s) =>
      Object.values(s.papers)
        .filter((p) => !p.pdf && p.noPdf?.needs === "browser" && (!p.noPdf.fromBrowser || p.noPdf.fromBrowser.state === "missed"))
        .sort((a, b) => (a.noPdf?.at ?? 0) - (b.noPdf?.at ?? 0)),
    ),
  )

export async function getInBrowser(ids: string[]) {
  try {
    const papers = await rpc.library.getInBrowser({ ids })
    const { updatePaper } = useLibraryStore.getState()
    for (const paper of papers) updatePaper(paper.id, { noPdf: paper.noPdf })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t`Couldn't open your browser.`)
  }
}

export async function showBrowser() {
  try {
    await rpc.library.showBrowser()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t`Couldn't open your browser.`)
  }
}
