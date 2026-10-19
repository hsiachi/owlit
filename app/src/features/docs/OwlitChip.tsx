import { t } from "@lingui/core/macro"
import type { WorkspaceFile } from "@owlit/protocol"
import { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { NoteDot } from "@/components/marks"
import { OwlitMark } from "@/components/owlit-mark"
import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import { isDesktop, rpc } from "@/lib/rpc"
import { cn } from "@/lib/utils"
import { useAgentWindow } from "@/features/agent/store"
import { RunsHover } from "@/features/runs/components"
import { openRun, useDoingLine, useOpenRuns } from "@/features/runs/hooks"
import { docKey } from "./comments/model"
import { newOwlitComments, useDocOwlit, useOwlitSeen, useOwlitSeenAt } from "./owlit"
import { useDocsStore } from "./store"
import { useDocsUiStore } from "./ui-store"

// The runs that work on a doc
const DOC_RUNS = ["meetings.goThrough"] as const

// New comments count as seen once they have been on screen this long
const SEEN_AFTER_MS = 3000

// Owlit in a doc's header, beside its comments and Shared (DESIGN.md › Owlit's runs): it is a member of
// the doc. Still while it isn't working here, its tooltip saying it works here only when asked; breathing
// while a run works on the doc (hover: what it is doing, Stop; click: the run); Owlit's dot once it left
// comments the user hasn't seen (click: the first of them). Kept out (the doc's ⋯ menu), there is no chip
// at all.
export function OwlitChip({ file }: { file: WorkspaceFile }) {
  const state = useDocOwlit(file.path)
  const runs = useOpenRuns(file.path, DOC_RUNS)
  const seenAt = useOwlitSeenAt(file.path)
  const fresh = useDocsStore(useShallow((s) => newOwlitComments(s.comments[file.id], seenAt)))
  const shown = useDocsUiStore((s) => s.commentsShown)

  // Comments on screen a moment are seen: the dot goes, and Owlit hears they were
  const count = fresh.length
  useEffect(() => {
    if (!count || !shown) return
    const timer = setTimeout(() => {
      useOwlitSeen.getState().markSeen(file.path)
      void rpc.initiative.feedback({ what: "seen", subject: file.path, detail: { comments: count } }).catch(() => undefined)
    }, SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [count, shown, file.path])

  if (!isDesktop || !state || state.out) return null
  if (runs[0]) return <WorkingChip runs={runs} />

  const first = fresh[0]
  return (
    <Tip label={t`Owlit works here only when you ask`}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          // Owlit's dot: to the first comment it left; otherwise the chip is where to ask
          if (first) useDocsUiStore.getState().setOpenComment(file.id, docKey(first.id))
          else askHere()
        }}
        className="h-7 px-2 font-normal text-muted-foreground hover:text-foreground"
      >
        <span className="relative">
          <OwlitMark />
          {first && <NoteDot label={false} className="absolute -top-0.5 -right-1 size-1.5" />}
        </span>
        Owlit
      </Button>
    </Tip>
  )
}

// Opens the Owlit panel beside the doc
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
