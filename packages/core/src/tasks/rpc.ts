import { z } from "zod"
import { noParams, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import type { debugTasks } from "./debug.ts"
import { LANE_LIMITS } from "./scheduler.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // The debug tasks of a development build; with them, tasks.debugEnqueue is offered
  debug?: ReturnType<typeof debugTasks>
}

export function registerTasks({ router, requireWorkspace, debug }: Deps) {
  const tasks = () => requireWorkspace().tasks
  const taskId = z.string().min(1)
  router.register("tasks.list", noParams, "read", () => tasks().list())
  router.register("tasks.cancel", z.object({ id: taskId }), "admin", ({ id }) => tasks().cancel(id))
  router.register("tasks.resume", z.object({ id: taskId }), "admin", ({ id }) => tasks().resume(id))
  if (debug) {
    const lanes = Object.keys(LANE_LIMITS) as [keyof typeof LANE_LIMITS, ...(keyof typeof LANE_LIMITS)[]]
    router.register(
      "tasks.debugEnqueue",
      z.object({
        subject: z.string().min(1),
        lane: z.enum(lanes).optional(),
        priority: z.enum(["waiting", "asked", "background"]).optional(),
        ms: z.number().nonnegative().optional(),
        steps: z.number().int().positive().optional(),
        fail: z.boolean().optional(),
        waitForYou: z.boolean().optional(),
      }), "admin",
      ({ subject, lane = "network", priority, ...params }) => {
        const task = tasks().enqueue(`debug.${lane}`, subject, priority)
        debug.params.set(task.id, params)
        return task
      },
    )
  }
}
