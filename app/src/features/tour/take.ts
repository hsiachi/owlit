import { toast } from "sonner"
import { rpc } from "@/lib/rpc"
import { useWorkspace } from "@/lib/workspace"
import { isExample, tourWhenExampleOpens, useTour } from "./store"

// Help › Take the tour: in the example it starts at once; elsewhere the example opens (copied the first
// time) and the tour starts there, since the tour points at the example's papers and draft
export function takeTour() {
  if (isExample(useWorkspace.getState().current?.name)) return useTour.getState().start()
  tourWhenExampleOpens()
  rpc.workspace.createExample().catch((error: unknown) => toast.error(error instanceof Error ? error.message : String(error)))
}
