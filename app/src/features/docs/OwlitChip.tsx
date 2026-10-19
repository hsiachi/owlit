import { t } from "@lingui/core/macro"
import type { WorkspaceFile } from "@owlit/protocol"
import { useEffect } from "react"
import { markSeen } from "@/app/seen"
import { NoteDot } from "@/components/marks"
import { OwlitMark } from "@/components/owlit-mark"
import { Tip } from "@/components/tip"
import { Button } from "@/components/ui/button"
import { isDesktop } from "@/lib/rpc"
import { useAgentWindow } from "@/features/agent/store"
import { docKey } from "./comments/model"
import { useDocOwlit, useNewOwlitComments } from "./owlit"
import { useDocsUiStore } from "./ui-store"

// New comments count as seen once they have been on screen this long
const SEEN_AFTER_MS = 3000

// Owlit in a doc's header, beside its comments and Shared: it is a member of the doc. Its tooltip says it
// works here only when asked, and a click opens the Owlit panel to ask; Owlit's dot once it left comments
// the user hasn't seen (click: the first of them). Kept out (the doc's ⋯ menu), there is no chip at all.
export function OwlitChip({ file }: { file: WorkspaceFile }) {
  const state = useDocOwlit(file.path)
  const fresh = useNewOwlitComments(file)
  const shown = useDocsUiStore((s) => s.commentsShown)

  // Comments on screen a moment are seen: the dot goes
  const count = fresh.length
  useEffect(() => {
    if (!count || !shown) return
    const timer = setTimeout(() => markSeen({ kind: "comments", path: file.path }), SEEN_AFTER_MS)
    return () => clearTimeout(timer)
  }, [count, shown, file.path])

  if (!isDesktop || !state || state.out) return null

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
