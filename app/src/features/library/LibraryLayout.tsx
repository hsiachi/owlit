import { Outlet } from "react-router-dom"
import { EditDetailsDialog } from "./components/EditDetailsDialog"

// Hosts the library routes plus the dialogs that any of them can open
export function LibraryLayout() {
  return (
    <>
      <Outlet />
      <EditDetailsDialog />
    </>
  )
}
