import { Outlet } from "react-router-dom"
import { SplitDialog } from "./components/SplitDialog"

export function KnowledgeLayout() {
  return (
    <>
      <Outlet />
      <SplitDialog />
    </>
  )
}
