import type { TaskLane } from "@owlit/protocol"
import { LANE_LIMITS, defineTask, type TaskDefinition } from "./scheduler.ts"
import { sleep } from "../net/http.ts"

export interface DebugTaskParams {
  ms?: number
  steps?: number
  fail?: boolean
  // Stops after the first step until tasks.resume
  waitForYou?: boolean
}

// Tasks that only sleep, one kind per lane (debug.<lane>), for trying the scheduler and the
// notifications from a development build. Their params live in memory; after a restart they run
// with the defaults.
export function debugTasks() {
  const params = new Map<string, DebugTaskParams>()
  const definitions: TaskDefinition[] = (Object.keys(LANE_LIMITS) as TaskLane[]).map((lane) =>
    defineTask(`debug.${lane}`, {
      lane,
      retries: 0,
      async run(ctx) {
        const { ms = 3000, steps = 6, fail = false, waitForYou = false } = params.get(ctx.task.id) ?? {}
        for (let step = 0; step < steps; step++) {
          await sleep(ms / steps, ctx.signal)
          ctx.progress(step + 1, steps)
          if (step === 0 && waitForYou) await ctx.waitForUser("confirm_spend", "A debug task is waiting for a yes.")
        }
        if (fail) throw new Error("The debug task failed, as asked.")
      },
    }),
  )
  return { definitions, params }
}
