// Commands from the app's own menu (the desktop app only)

import type { router as appRouter } from "@/app/router"
import { useAgentWindow } from "@/features/agent/store"
import { openSettings } from "@/features/settings/store"
import { openShortcuts } from "./shortcuts"

export function startMenu(router: typeof appRouter) {
  window.owlit?.onMenu((command) => {
    if (command === "settings") openSettings()
    if (command === "shortcuts") openShortcuts()
    if (command === "how-to") {
      // The agent window isn't offered on Chat, which is the same conversation at full size
      const go = router.state.location.pathname.startsWith("/chat") ? router.navigate("/") : Promise.resolve()
      void go.then(() => useAgentWindow.getState().askHowTo())
    }
  })
}
