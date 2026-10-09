import { createBrowserRouter } from "react-router-dom"
import { Shell } from "@/app/Shell"
import { Placeholder } from "@/app/Placeholder"
import { KnowledgeLayout } from "@/features/knowledge/KnowledgeLayout"
import { KnowledgePage } from "@/features/knowledge/pages/KnowledgePage"
import { LoosePage } from "@/features/knowledge/pages/LoosePage"
import { TopicPage } from "@/features/knowledge/pages/TopicPage"
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

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    children: [
      { index: true, element: <Placeholder name="Home" /> },
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
        path: "knowledge",
        element: <KnowledgeLayout />,
        children: [
          { index: true, element: <KnowledgePage /> },
          { path: "loose", element: <LoosePage /> },
          { path: ":topicId", element: <TopicPage /> },
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
