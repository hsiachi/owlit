import { createBrowserRouter } from "react-router-dom"
import { Shell } from "@/app/Shell"
import { Placeholder } from "@/app/Placeholder"
import { ChatLayout } from "@/features/chat/ChatLayout"
import { ChatEmpty } from "@/features/chat/components/ChatEmpty"
import { ChatView } from "@/features/chat/components/ChatView"

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
      { path: "docs", element: <Placeholder name="Docs" /> },
      { path: "knowledge", element: <Placeholder name="Knowledge" /> },
      { path: "library", element: <Placeholder name="Library" /> },
    ],
  },
])
