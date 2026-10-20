import { I18nProvider, useLingui } from "@lingui/react"
import { interfaceLocale } from "@owlit/protocol"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { startActivity } from "@/app/activity"
import { startSeen } from "@/app/seen"
import { startAgentChanges } from "@/app/agent-changes"
import { startMenu } from "@/app/menu"
import { startModality } from "@/app/modality"
import { startTextMenu } from "@/app/text-menu"
import { startUiHandlers } from "@/app/ui-handlers"
import { startAppearance } from "@/features/settings/appearance"
import { startSettings } from "@/features/settings/store"
import { startTasks } from "@/features/tasks/store"
import { startStartedChats } from "@/features/chat/started"
import { startConnectors } from "@/features/chat/store"
import { startUpdates } from "@/features/updates/store"
import { PairDialog } from "@/features/extension/PairDialog"
import { startExtension } from "@/features/extension/store"
import { startShares } from "@/features/docs/share/store"
import { startImports } from "@/features/library/imports"
import { applyLocale, i18n } from "@/lib/i18n"
import { bridge, onNotify } from "@/lib/rpc"
import { startUiActions } from "@/lib/ui-actions"
import { startWorkspace } from "@/lib/workspace"
// These keep their stores in step with the workspace from the moment they load
import "@/features/library/disk"
import "@/features/threads/disk"
import "./index.css"

// The platform styles its scrollbars (index.css); in a plain browser, guess from the user agent
document.documentElement.dataset.platform =
  bridge?.platform ?? (/Mac/.test(navigator.userAgent) ? "darwin" : "other")
// The chosen theme, paper tone and language (Settings › Appearance), before anything is drawn
startAppearance()
applyLocale(bridge?.locale ?? interfaceLocale("system", navigator.languages))
startSettings()
startUpdates()
startExtension()

// Listening to core: the open workspace, its background tasks, what it asks this window to do, and
// what agents changed
startWorkspace()
startTasks()
startStartedChats()
startConnectors()
startShares()
startImports()
startUiActions()
startAgentChanges()

startModality()

onNotify("core.hello", ({ version, node }) => console.info(`[owlit] core ${version} ready (Node ${node})`))

startActivity(router)
startSeen()
startUiHandlers(router)
startMenu(router)
startTextMenu()

// A new language remounts the page so every word is said again in it (lib/i18n.ts)
function Routed() {
  const { i18n } = useLingui()
  return <RouterProvider key={i18n.locale} router={router} />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <Routed />
      {/* On every page, the welcome and the first launch too: pairing needs no workspace */}
      <PairDialog />
    </I18nProvider>
  </StrictMode>,
)
