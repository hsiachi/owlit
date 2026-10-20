import { z } from "zod"
import { noParams, type Router } from "../rpc/index.ts"
import type { Updates } from "./updates.ts"

interface Deps {
  router: Router
  updates: Updates
}

export function registerUpdates({ router, updates }: Deps) {
  router.register("updates.get", noParams, "read", () => updates.view())
  router.register("updates.check", noParams, "admin", () => updates.check())
  router.register("updates.setAuto", z.object({ auto: z.boolean() }), "admin", ({ auto }) => updates.setAuto(auto))
  router.register("updates.seen", noParams, "admin", () => updates.seen())
  router.register("updates.restart", z.object({ force: z.boolean().optional() }), "admin", ({ force }) => updates.restart(force ?? false))
}
