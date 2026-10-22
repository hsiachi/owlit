import { z } from "zod"
import { chatId } from "../chats/rpc.ts"
import type { PersonId } from "@owlit/protocol"
import { noParams, type Caller, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // The person at the window, whose journal and seen marks a summary reads (Core.personAt)
  personAt: (caller: Caller) => Promise<PersonId>
}

// projects.*: the workspace's folders marked by a project.md. projects.changed is told through the
// workspace's projectsChanged (core.ts).
export function registerProjects({ router, requireWorkspace, personAt }: Deps) {
  router.register("projects.list", noParams, "read", async () => ({ projects: await requireWorkspace().projects.list() }))
  router.register("projects.ofChat", z.object({ chatId }), "read", async ({ chatId }) => ({ projects: await requireWorkspace().projects.projectsOf({ kind: "chat", id: chatId }) }))
  router.register("projects.summary", noParams, "read", async (_, caller) => requireWorkspace().projectsSummary(await personAt(caller)))
}
