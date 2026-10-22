import { z } from "zod"
import { chatId } from "../chats/rpc.ts"
import { noParams, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
}

// projects.*: the workspace's folders marked by a project.md. projects.changed is told through the
// workspace's projectsChanged (core.ts).
export function registerProjects({ router, requireWorkspace }: Deps) {
  router.register("projects.list", noParams, "read", async () => ({ projects: await requireWorkspace().projects.list() }))
  router.register("projects.ofChat", z.object({ chatId }), "read", async ({ chatId }) => ({ projects: await requireWorkspace().projects.projectsOf({ kind: "chat", id: chatId }) }))
}
