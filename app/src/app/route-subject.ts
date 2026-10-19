import { matchRoutes } from "react-router-dom"

// What the page on screen is about: the paper, doc, chat or thread its route names. Matched against the
// same paths as router.tsx, ranked as the router ranks them, so a page of its own added under a place is
// not taken for a thing with that id.
export type RouteSubject = { kind: "paper" | "doc" | "chat" | "thread"; id: string }

// router.tsx's routes, by path only; a subject is the one id param each place's item page takes
const routes = [
  { path: "/chat/:chatId" },
  { path: "/docs/:docId" },
  { path: "/threads/:threadId" },
  { path: "/library/:paperId" },
]
const KIND: Record<string, RouteSubject["kind"]> = { chatId: "chat", docId: "doc", threadId: "thread", paperId: "paper" }

export function routeSubject(pathname: string): RouteSubject | null {
  const params = matchRoutes(routes, pathname)?.[0]?.params ?? {}
  for (const [param, kind] of Object.entries(KIND)) {
    const id = params[param]
    if (id) return { kind, id }
  }
  return null
}
