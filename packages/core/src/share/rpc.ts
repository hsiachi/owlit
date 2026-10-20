import { z } from "zod"
import { docPath, noParams, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
}

export function registerShare({ router, requireWorkspace }: Deps) {
  const shares = () => requireWorkspace().shares
  const permission = z.enum(["comment", "view"])
  router.register("share.list", noParams, "read", () => shares().list())
  router.register("share.create", z.object({ path: docPath, notes: z.boolean() }), "admin", ({ path, notes }) => shares().create(path, notes))
  router.register("share.update", z.object({ path: docPath, permission: permission.optional(), notes: z.boolean().optional() }), "admin", ({ path, ...change }) =>
    shares().update(path, change),
  )
  router.register("share.stop", z.object({ path: docPath, forget: z.boolean().optional() }), "admin", ({ path, forget }) => shares().stop(path, forget))
  router.register("share.comments", z.object({ path: docPath }), "read", ({ path }) => shares().commentsOf(path))
  router.register("share.reply", z.object({ path: docPath, parent: z.string().min(1), text: z.string().trim().min(1).max(4000) }), "admin", ({ path, parent, text }) =>
    shares().reply(path, parent, text),
  )
  router.register("share.resolve", z.object({ path: docPath, id: z.string().min(1), resolved: z.boolean() }), "admin", ({ path, id, resolved }) =>
    shares().resolve(path, id, resolved),
  )
}
