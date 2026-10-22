import { z } from "zod"
import { noParams, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"

interface Deps {
  router: Router
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
}

export function registerThreads({ router, requireWorkspace }: Deps) {
  const threads = () => requireWorkspace().threads
  const cellWrite = z.object({
    text: z.string(),
    depth: z.enum(["title", "abstract", "part", "full"]),
    passage: z.object({ quote: z.string().min(1), page: z.number().int().min(1) }).optional(),
    rel: z.enum(["supports", "challenges", "related"]).optional(),
    sentence: z.string().optional(),
  })
  const group = z.object({ id: z.string().regex(/^[\w-]+$/, "letters, digits, - and _"), name: z.string().min(1), one: z.string().optional(), parent: z.string().optional() })
  router.register("threads.list", noParams, "read", () => threads().list())
  router.register("threads.get", z.object({ id: z.string().min(1) }), "read", ({ id }) => threads().get(id))
  router.register(
    "threads.write",
    z.object({
      id: z.string().optional(),
      asked: z.string().optional(),
      title: z.string().optional(),
      sources: z.array(z.string()).optional(),
      report: z.string().optional(),
      one: z.string().optional(),
      columns: z.array(z.object({ id: z.string().regex(/^[\w-]+$/).optional(), question: z.string() })).optional(),
      rows: z.array(z.object({ id: z.string().min(1), is: z.string().optional(), cells: z.record(z.string(), cellWrite).optional(), group: z.string().optional(), groups: z.array(z.string()).optional(), foundBy: z.string().optional() })).optional(),
      groups: z.array(group).optional(),
      grouping: z.string().optional(),
      newGrouping: z.string().optional(),
      removeRows: z.array(z.string()).optional(),
      note: z.string().optional(),
      chatId: z.string().optional(),
      docPath: z.string().optional(),
    }), "own",
    (params, caller) => threads().write(params, caller),
  )
  router.register(
    "threads.edit",
    z.object({
      id: z.string().min(1),
      edit: z.object({ op: z.literal("view"), groupBy: z.string().min(1) }),
    }),
    // How the user looks at it is its mark
    "meta",
    ({ id, edit }) => threads().edit(id, edit),
  )
  router.register("threads.about", z.object({ id: z.string().min(1) }), "read", ({ id }) => threads().about(id))
  router.register("threads.delete", z.object({ id: z.string().min(1) }), "structure", ({ id }, caller) => threads().delete(id, caller))
  router.register("threads.undelete", z.object({ id: z.string().min(1) }), "structure", ({ id }, caller) => threads().undelete(id, caller))
}
