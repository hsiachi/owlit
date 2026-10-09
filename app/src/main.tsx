import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { router } from "@/app/router"
import { startUiActions } from "@/app/ui-actions"
import { startActivity } from "@/lib/activity"
import { onNotify } from "@/lib/rpc"
import "@/lib/workspace"
import "@/features/tasks/store"
import "@/features/library/disk"
import "@/features/knowledge/disk"
import "@/lib/versions"
import "./index.css"

// Follow the system appearance; the dark tokens in index.css hang off the .dark class
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)")
const applyScheme = () => document.documentElement.classList.toggle("dark", darkQuery.matches)
applyScheme()
darkQuery.addEventListener("change", applyScheme)

// Focus rings are for keyboard navigation (index.css, focus-key). A press of the pointer, or typing
// inside a field, does not count; Tab, arrows, Esc and the like do.
const setModality = (m: "pointer" | "keyboard") => {
  if (document.documentElement.dataset.modality !== m) document.documentElement.dataset.modality = m
}
window.addEventListener("pointerdown", () => setModality("pointer"), true)
window.addEventListener(
  "keydown",
  (e) => {
    if (e.metaKey || e.ctrlKey || ["Shift", "Meta", "Control", "Alt"].includes(e.key)) return
    const t = e.target
    const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
    if (typing && e.key !== "Tab") return
    setModality("keyboard")
  },
  true,
)

onNotify("core.hello", ({ version, node }) => console.info(`[owlit] core ${version} ready (Node ${node})`))

startActivity(router)
startUiActions(router)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
