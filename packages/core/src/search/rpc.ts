import { z } from "zod"
import { noParams, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
}

// search.*, and links.to, which the index answers
export function registerSearch({ router, requireWorkspace }: Deps) {
  const search = () => requireWorkspace().search
  const query = z.object({ q: z.string() })
  router.register("search.palette", query, "read", ({ q }) => search().palette(q))
  router.register("search.papers", query.extend({ marked: z.boolean().optional() }), "read", ({ q, marked }) => search().papers(q, marked))
  router.register("search.status", noParams, "read", () => search().status())
  router.register("search.rebuild", noParams, "read", () => {
    search().rebuild()
    return null
  })
  router.register("links.to", z.object({ uri: z.string().min(1) }), "read", ({ uri }) => search().linksTo(uri))
}
