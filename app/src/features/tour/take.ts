import { rpc } from "@/lib/rpc"
import { toastError } from "@/lib/toast"
import { switchWorkspace, useWorkspace } from "@/lib/workspace"
import { isExample, tourWhenExampleOpens, useTour } from "./store"

// Help › Take the tour: in the example it starts at once. The tour points at the example's papers and
// draft, so elsewhere the example has to open (copied the first time): from a workspace of the person's
// own that is leaving it, so they are asked first (TourAsk); with none open it simply opens.
export function takeTour() {
  const current = useWorkspace.getState().current
  if (isExample(current?.name)) return useTour.getState().start()
  if (current) return useTour.setState({ asking: true })
  void openExampleForTour(() => undefined)
}

// Opens the example, as any switch does (the open workspace's writes flushed first), and the tour starts
// once it has opened. goHome leaves the page the window shows, which belongs to the workspace being left,
// before the example opens, so the tour's first stop takes it from there.
export async function openExampleForTour(goHome: () => void) {
  const cancelTour = tourWhenExampleOpens()
  try {
    await switchWorkspace(async () => {
      goHome()
      return rpc.workspace.createExample()
    })
  } catch (error) {
    cancelTour()
    toastError(error)
  }
}
