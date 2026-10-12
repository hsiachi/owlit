import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { startActivity } from "@/app/activity"
import { startAgentChanges } from "@/app/agent-changes"
import { startMenu } from "@/app/menu"
import { startModality } from "@/app/modality"
import { startTextMenu } from "@/app/text-menu"
import { startUiHandlers } from "@/app/ui-handlers"
import { startTrail } from "@/features/home/trail"
import { startAppearance } from "@/features/settings/appearance"
import { startSettings } from "@/features/settings/store"
import { startTasks } from "@/features/tasks/store"
import { onNotify } from "@/lib/rpc"
import { startUiActions } from "@/lib/ui-actions"
import { startWorkspace } from "@/lib/workspace"
// These keep their stores in step with the workspace from the moment they load
import "@/features/library/disk"
import "@/features/knowledge/disk"
import "./index.css"

// The chosen theme and paper tone (Settings › Appearance), before anything is drawn
startAppearance()
startSettings()

// Listening to core: the open workspace, its background tasks, what it asks this window to do, and
// what agents changed
startWorkspace()
startTasks()
startUiActions()
startAgentChanges()

startModality()

onNotify("core.hello", ({ version, node }) => console.info(`[owlit] core ${version} ready (Node ${node})`))

startActivity(router)
startTrail()
startUiHandlers(router)
startMenu(router)
startTextMenu()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
