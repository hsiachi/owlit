// Commands from the app's own menu (the desktop app only)

import type { router as appRouter } from "@/app/router"
import { askOwlitHowTo } from "@/features/agent/store"
import { showIntro } from "@/features/onboarding/store"
import { openImportDialog } from "@/features/library/imports"
import { openSettings } from "@/features/settings/store"
import { takeTour } from "@/features/tour/take"
import { openNewWorkspace } from "@/features/welcome/NewWorkspaceDialog"
import { openReleaseNotes } from "@/features/updates/store"
import { t } from "@lingui/core/macro"
import { toast } from "sonner"
import { bridge, rpc } from "@/lib/rpc"
import { openShortcuts } from "./shortcuts"

// Help › Copy Diagnostics: core's short report, ready to paste into a message
async function copyDiagnostics() {
  try {
    const report = await rpc.core.diagnostics()
    await navigator.clipboard.writeText(report)
    toast(t`Copied diagnostics`, { description: t`Paste them into a message to whoever helps you.` })
  } catch {
    toast.error(t`The diagnostics couldn't be copied.`)
  }
}

export function startMenu(router: typeof appRouter) {
  bridge?.onMenu((command) => {
    if (command === "settings") openSettings()
    if (command === "shortcuts") openShortcuts()
    if (command === "how-to") askOwlitHowTo(router.state.location.pathname, (to) => router.navigate(to))
    if (command === "tour") takeTour()
    if (command === "new-workspace") openNewWorkspace()
    if (command === "whats-new") openReleaseNotes()
    if (command === "intro") showIntro()
    if (command === "import") openImportDialog()
    if (command === "diagnostics") void copyDiagnostics()
  })
}
