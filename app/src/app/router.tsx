import { createBrowserRouter } from "react-router-dom"
import { Shell } from "@/app/Shell"
import { Placeholder } from "@/app/Placeholder"
import { LibraryLayout } from "@/features/library/LibraryLayout"
import { LibraryPage } from "@/features/library/pages/LibraryPage"
import { PaperPage } from "@/features/library/pages/PaperPage"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Placeholder name="Home" /> },
      { path: "chat", element: <Placeholder name="Chat" /> },
      { path: "docs", element: <Placeholder name="Docs" /> },
      { path: "knowledge", element: <Placeholder name="Knowledge" /> },
      {
        path: "library",
        element: <LibraryLayout />,
        children: [
          { index: true, element: <LibraryPage /> },
          { path: ":paperId", element: <PaperPage /> },
        ],
      },
    ],
  },
])
