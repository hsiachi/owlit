import { createBrowserRouter } from "react-router-dom"
import { Shell } from "@/app/Shell"
import { ChatLayout } from "@/features/chat/ChatLayout"
import { ChatEmpty } from "@/features/chat/components/ChatEmpty"
import { ChatView } from "@/features/chat/components/ChatView"
import { DocsLayout } from "@/features/docs/DocsLayout"
import { DocPage } from "@/features/docs/pages/DocPage"
import { DocsHome } from "@/features/docs/pages/DocsHome"
import { LibraryLayout } from "@/features/library/LibraryLayout"
import { LibraryPage } from "@/features/library/pages/LibraryPage"
import { PaperPage } from "@/features/library/pages/PaperPage"
import { UpNextPage } from "@/features/library/pages/UpNextPage"
import { HomePage } from "@/features/home/HomePage"
import { ThreadsPage } from "@/features/threads/pages/ThreadsPage"
import { ThreadPage } from "@/features/threads/pages/ThreadPage"

// route-subject.ts matches the same paths to say what a page is about: a new page goes there too
export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: "chat",
        element: <ChatLayout />,
        children: [
          { index: true, element: <ChatEmpty /> },
          { path: ":chatId", element: <ChatView /> },
        ],
      },
      {
        path: "docs",
        element: <DocsLayout />,
        children: [
          { index: true, element: <DocsHome /> },
          { path: ":docId", element: <DocPage /> },
        ],
      },
      {
        path: "threads",
        children: [
          { index: true, element: <ThreadsPage /> },
          { path: ":threadId", element: <ThreadPage /> },
        ],
      },
      {
        path: "library",
        element: <LibraryLayout />,
        children: [
          { index: true, element: <LibraryPage /> },
          { path: "up-next", element: <UpNextPage /> },
          { path: ":paperId", element: <PaperPage /> },
        ],
      },
    ],
  },
])
