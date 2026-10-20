import type { PromptInput } from "@owlit/protocol"
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

  // Whose a doc is, for an agent writing one of its own (agents.writeDoc): nobody's while it isn't there,
  // so making it is the caller's; else whoever made it, as the change log says, and whoever changed it
  // since. A doc the log has no record of making (made before the log, or outside owlit, or its entries
  // since dropped) is the person's.
  async function docTarget(file: string): Promise<Target> {
    const ws = requireWorkspace()
    const files = await fs.target([file])
    const rel = files.files?.[0]
    if (!rel || files.notDoc || (await fs.text(rel)) === null) return { ...files, what: "doc" }
    const changes = (await ws.changes.list({ target: { kind: "doc", path: rel } })).reverse()
    const made = changes.findLast((c) => c.action === "create")
    const by = made?.actor ?? (await ws.recorder.actorOf(WINDOW))
    const since = made ? changes.slice(changes.indexOf(made) + 1) : []
    return { ...files, what: "doc", by, touchedBy: since.map((c) => c.actor) }
  }
}
