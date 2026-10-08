import { Outlet } from "react-router-dom"
import { Toaster } from "@/components/ui/sonner"
import { EditDetailsDialog } from "./components/EditDetailsDialog"

// Hosts the library routes plus the dialogs that any of them can open.
// The Toaster lives here until the app shell mounts one for every feature.
export function LibraryLayout() {
  return (
    <>
      <Outlet />
      <EditDetailsDialog />
      <Toaster position="bottom-right" />
    </>
  )
}
