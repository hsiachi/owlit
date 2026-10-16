import { t } from "@lingui/core/macro"
import type { WorkspaceFile } from "@owlit/protocol"
import { OwlitMark } from "@/components/owlit-mark"
import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import { isDesktop } from "@/lib/rpc"
import { cn } from "@/lib/utils"
import { useAgentWindow } from "@/features/agent/store"
import { RunsHover } from "@/features/runs/components"
import { openRun, useDoingLine, useOpenRuns } from "@/features/runs/hooks"
import { useDocOwlit } from "./owlit"

// The runs that work on a doc
const DOC_RUNS = ["docs.review"] as const

// Owlit in a doc's header, beside its comments and Shared (DESIGN.md › Owlit's runs): it is a member of
// the doc. Still while it isn't working here; breathing while a run works on the doc, whose hover card
// says what it is doing with Stop and whose click opens the run. Kept out (the doc's ⋯ menu), there is
// no chip at all.
export function OwlitChip({ file }: { file: WorkspaceFile }) {
  const state = useDocOwlit(file.path)
  const runs = useOpenRuns(file.path, DOC_RUNS)
  if (!isDesktop || !state || state.out) return null
  const working = runs[0]
  if (working) return <WorkingChip runs={runs} />
  return (
    <Tip label={t`Owlit works here only when you ask`}>
      <Button variant="ghost" size="sm" onClick={askHere} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
        <OwlitMark />
        Owlit
      </Button>
    </Tip>
  )
}

// The still chip is where to ask: it opens the Owlit panel beside the doc
function askHere() {
  const panel = useAgentWindow.getState()
  if (panel.stage !== "open") panel.togglePanel()
}

function WorkingChip({ runs }: { runs: ReturnType<typeof useOpenRuns> }) {
  const line = useDoingLine(runs[0]!)
  const chatId = runs.find((r) => r.chatId)?.chatId
  return (
    <RunsHover tasks={runs} side="bottom" align="end">
      <Button variant="ghost" size="sm" aria-label={line} onClick={() => chatId && void openRun(chatId)} className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground">
        <span className="relative">
          <OwlitMark />
          <span aria-hidden className={cn("absolute -top-0.5 -right-1 size-1.5 rounded-full bg-muted-foreground", "animate-ring-breathe motion-reduce:animate-none")} />
        </span>
        Owlit
      </Button>
    </RunsHover>
  )
}
