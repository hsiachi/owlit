// Commands from the app's own menu (the desktop app only)

import type { router as appRouter } from "@/app/router"
import { askOwlitHowTo } from "@/features/agent/store"
import { showIntro } from "@/features/onboarding/store"
import { openImportDialog } from "@/features/library/imports"
import { openSettings } from "@/features/settings/store"
import { takeTour } from "@/features/tour/take"
import { bridge } from "@/lib/rpc"
import { openShortcuts } from "./shortcuts"

export function startMenu(router: typeof appRouter) {
  bridge?.onMenu((command) => {
    if (command === "settings") openSettings()
    if (command === "shortcuts") openShortcuts()
    if (command === "how-to") askOwlitHowTo(router.state.location.pathname, (to) => router.navigate(to))
    if (command === "tour") takeTour()
    if (command === "intro") showIntro()
    if (command === "import") openImportDialog()
  })
}
