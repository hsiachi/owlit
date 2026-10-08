import { createBrowserRouter } from "react-router-dom"
import { Shell } from "@/app/Shell"
import { Placeholder } from "@/app/Placeholder"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Placeholder name="Home" /> },
      { path: "chat", element: <Placeholder name="Chat" /> },
      { path: "docs", element: <Placeholder name="Docs" /> },
      { path: "knowledge", element: <Placeholder name="Knowledge" /> },
      { path: "library", element: <Placeholder name="Library" /> },
    ],
  },
])
