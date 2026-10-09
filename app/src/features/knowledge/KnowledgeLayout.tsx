import { Outlet } from "react-router-dom"
import { SplitDialog } from "./components/TopicMenu"

export function KnowledgeLayout() {
  return (
    <>
      <Outlet />
      <SplitDialog />
    </>
  )
}
