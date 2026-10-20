import { isOwlit, type ActorId, type Change, type PromptInput } from "@owlit/protocol"
import { z } from "zod"
import { chatId, messageSchema as message, roleSchema } from "../chats/rpc.ts"
import { noParams, WINDOW, type Router } from "../rpc/index.ts"
import type { Target } from "./policy.ts"
import type { Workspace } from "../workspace/workspace.ts"
import type { Agents } from "./agents.ts"
import type { AgentFs } from "./fs.ts"
import { guide } from "./guide.ts"
import { AGENT_RULES } from "./rules.ts"
import type { Turns } from "./turns.ts"

interface Deps {
  router: Router
  agents: Agents
  turns: Turns
  fs: AgentFs
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
}

export function registerAgents({ router, agents, turns, fs, requireWorkspace }: Deps) {
  // What agents are told about owlit (owlit-mcp's instructions)
  router.register("agents.rules", noParams, "read", () => AGENT_RULES)
  router.register("agents.guide", z.object({ topic: z.string().optional() }), "read", ({ topic }) => guide(topic))

  router.register("agents.list", noParams, "read", () => agents.list())
  router.register("agents.check", z.object({ id: z.string() }), "read", ({ id }) => agents.check(id))
  router.register("agents.setUp", z.object({ id: z.string() }), "admin", ({ id }) => agents.setUp(id))
  router.register("agents.cancelSetUp", z.object({ id: z.string() }), "admin", ({ id }) => agents.cancelSetUp(id))
  router.register("agents.add", z.object({ name: z.string(), command: z.string() }), "admin", ({ name, command }) => agents.add(name, command))
  router.register("agents.remove", z.object({ id: z.string() }), "admin", ({ id }) => agents.remove(id))
  router.register("agents.signIn", z.object({ id: z.string(), methodId: z.string(), apiKey: z.string().optional() }), "admin", ({ id, methodId, apiKey }) => agents.signIn(id, methodId, apiKey))
  router.register("agents.cancelSignIn", z.object({ id: z.string() }), "admin", ({ id }) => agents.cancelSignIn(id))
  router.register("agents.signOut", z.object({ id: z.string(), methodId: z.string().optional() }), "admin", ({ id, methodId }) => agents.signOut(id, methodId))
  router.register(
    "agents.prompt",
    z.object({
      chatId,
      connectorId: z.string(),
      modelId: z.string().optional(),
      role: roleSchema.optional(),
      effortId: z.string().optional(),
      input: z.looseObject({ text: z.string(), mentions: z.array(z.looseObject({ uri: z.string(), title: z.string() })), attachments: z.array(z.looseObject({ name: z.string() })) }) as unknown as z.ZodType<PromptInput>,
      userMessage: message,
      assistantMessageId: z.string().min(1),
    }), "admin",
    async (req) => {
      return { stopReason: await turns.prompt(req) }
    },
  )
  router.register("agents.deleteDocs", z.object({ paths: z.array(z.string().min(1)).min(1) }), { touches: "structure", target: ({ paths }) => fs.target(paths) }, async ({ paths }, caller) => ({ deleted: await fs.remove(paths, caller) }))
  // A doc of Owlit's own (a reading of material it went through): own, decided on whose the doc is (docTarget), so every
  // role may write one and none may write the person's this way
  router.register("agents.writeDoc", z.object({ path: z.string().min(1), content: z.string() }), { touches: "own", target: ({ path: file }) => docTarget(file) }, ({ path: file, content }, caller) => fs.writeOwn(file, content, caller))
  router.register("agents.moveDoc", z.object({ path: z.string().min(1), to: z.string().min(1) }), { touches: "structure", target: ({ path: from, to }) => fs.target([from, to]) }, async ({ path: from, to }, caller) => ({ path: await fs.move(from, to, caller) }))

  router.register("agents.cancel", z.object({ chatId }), "admin", ({ chatId }) => turns.cancel(chatId))
  router.register("agents.running", noParams, "read", () => turns.inFlight())
  router.register("agents.respondPermission", z.object({ chatId, requestId: z.string(), optionId: z.string() }), "admin", ({ chatId, requestId, optionId }) =>
    turns.respondPermission(chatId, requestId, optionId),
  )
  const answer = z.object({ picks: z.array(z.string()).optional(), text: z.string().optional() })
  router.register("agents.answerQuestion", z.object({ chatId, requestId: z.string(), answers: z.record(z.string(), answer).nullable() }), "admin", ({ chatId, requestId, answers }) =>
    turns.answerQuestion(chatId, requestId, answers),
  )

  // Whose a doc is, for an agent writing one of its own (agents.writeDoc), from the change log (docOwner)
  async function docTarget(file: string): Promise<Target> {
    const ws = requireWorkspace()
    const files = await fs.target([file])
    const rel = files.files?.[0]
    if (!rel || files.notDoc) return { ...files, what: "doc" }
    const log = (await ws.changes.list({ target: { kind: "doc" } })).reverse()
    const owner = docOwner(rel, log, (await fs.text(rel)) !== null, await ws.recorder.actorOf(WINDOW))
    return { ...files, what: "doc", ...owner }
  }
}

// Whose the doc at rel is, from the log's doc entries (oldest first): nobody's while it isn't there, so
// making it is the caller's; else whoever made it, and whoever changed it since. A doc the log has no
// record of making (made before the log, or outside owlit, or its entries since dropped) is the person's.
// Moving a doc, or taking it away and back, doesn't make it anyone else's: one that arrived by a move is
// whose it was where it came from, one an undo brought back whose it was before it went, and one Owlit
// took away is still whose it was, so it can't be written anew in its place as Owlit's own. Whoever moved,
// took away or brought it back has touched it.
export function docOwner(rel: string, log: Change[], present: boolean, person: ActorId): Pick<Target, "by" | "touchedBy"> {
  const at = (id: string | undefined) => (id ? log.findIndex((c) => c.id === id) : -1)
  // As of before the entry at end, walking back along moves and undos (each step goes to an earlier entry)
  const as = (path: string, end: number): { by: ActorId; touchedBy: ActorId[] } => {
    const mine = log.slice(0, end).flatMap((c, i) => (c.target.path === path ? [i] : []))
    const made = mine.findLast((i) => log[i]!.action === "create")
    if (made === undefined) return { by: person, touchedBy: mine.map((i) => log[i]!.actor) }
    const create = log[made]!
    const since = mine.filter((i) => i > made).map((i) => log[i]!.actor)
    const came = cameFrom(made)
    if (!came) return { by: create.actor, touchedBy: since }
    const was = as(came.path, came.end)
    return { by: was.by, touchedBy: [...was.touchedBy, create.actor, ...since] }
  }
  // Where a create's doc was before: an undo of its delete, or the arriving half of a move (the nearest
  // delete of another path before it in the same write)
  const cameFrom = (made: number): { path: string; end: number } | undefined => {
    const create = log[made]!
    const undone = at(create.undoes)
    if (undone >= 0 && undone < made && log[undone]!.action === "delete") return { path: log[undone]!.target.path, end: undone }
    const writeId = create.origin.writeId
    if (!writeId) return undefined
    for (let i = made - 1; i >= 0; i--) {
      const c = log[i]!
      if (c.origin.writeId === writeId && c.action === "delete" && c.target.path !== create.target.path) return { path: c.target.path, end: i }
    }
    return undefined
  }
  if (present) return as(rel, log.length)
  const last = log.findLastIndex((c) => c.target.path === rel)
  if (last < 0 || log[last]!.action !== "delete" || !isOwlit(log[last]!.actor)) return {}
  const was = as(rel, last)
  return { by: was.by, touchedBy: [...was.touchedBy, log[last]!.actor] }
}
