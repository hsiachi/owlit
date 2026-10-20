import { RpcErrorCode } from "@owlit/protocol"
import { z } from "zod"
import type { Target } from "../agents/policy.ts"
import { noParams, RpcFailure, WINDOW, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
}

export function registerMemory({ router, requireWorkspace }: Deps) {
  router.register("memory.list", noParams, "read", async () => {
    const memory = requireWorkspace().memory
    return { lines: await memory.list(), claudeNotes: await memory.claudeNotes() }
  })
  const memoryKind = z.enum(["work", "about"])
  router.register(
    "memory.write",
    z.object({ op: z.enum(["add", "replace", "remove"]), id: z.string().optional(), kind: memoryKind.optional(), text: z.string().optional(), chatId: z.string().optional() }),
    { touches: "own", target: ({ op, id }) => memoryTarget(op === "add" ? undefined : id) },
    async ({ op, id, kind, text }, caller) => {
      // Said to the agent, so plain English
      const need = (what: string) => {
        throw new RpcFailure(RpcErrorCode.InvalidParams, `memory_write with op "${op}" needs ${what}.`)
      }
      return requireWorkspace().memory.agentWrite(
        op === "add" ? { op, kind: kind ?? need("kind"), text: text ?? need("text") } : op === "replace" ? { op, id: id ?? need("id"), text: text ?? need("text"), ...(kind ? { kind } : {}) } : { op, id: id ?? need("id") },
        caller,
      )
    },
  )
  router.register(
    "memory.put",
    z.object({ id: z.string().optional(), kind: memoryKind, text: z.string(), at: z.number().optional(), chatId: z.string().optional() }),
    { touches: "own", target: ({ id }) => memoryTarget(id) },
    (input, caller) => requireWorkspace().memory.put(input, caller),
  )
  router.register("memory.remove", z.object({ id: z.string().min(1) }), { touches: "own", target: ({ id }) => memoryTarget(id) }, ({ id }, caller) => requireWorkspace().memory.remove(id, caller))
  router.register(
    "memory.decideClaudeNotes",
    z.object({ keep: z.array(z.object({ file: z.string().min(1), kind: memoryKind, text: z.string() })), drop: z.array(z.string().min(1)) }), "own",
    ({ keep, drop }, caller) => requireWorkspace().memory.decideClaudeNotes(keep, drop, caller),
  )

  // Whose a memory line is: whoever kept it, as the change log says, and whoever changed it since. A line
  // the log has no record of was written by hand in memory.md, the person's, unless it names the chat it
  // came from. No id: a line not there yet, the caller's to make.
  async function memoryTarget(id: string | undefined): Promise<Target> {
    if (!id) return { what: "memory line" }
    const ws = requireWorkspace()
    const line = (await ws.memory.list()).find((l) => l.id === id)
    if (!line) return { what: "memory line" }
    const changes = (await ws.changes.list({ target: { kind: "memory", part: id } })).reverse()
    const made = changes.findLast((c) => c.action === "create")
    const by = made?.actor ?? (line.chatId ? undefined : await ws.recorder.actorOf(WINDOW))
    const since = made ? changes.slice(changes.indexOf(made) + 1) : changes
    return { what: "memory line", ...(by ? { by } : {}), touchedBy: since.map((c) => c.actor) }
  }
}
