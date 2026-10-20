import type { ActorId, PersonId } from "@owlit/protocol"
import { z } from "zod"
import { noParams, type Caller, type Notifier, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { docPassages } from "./passages.ts"
import { docProposals } from "./proposals.ts"
import type { Undo } from "./undo.ts"

interface Deps {
  router: Router
  notifier: Notifier
  undo: Undo
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // The person at the window, whose seen marks these are (Core.personAt)
  personAt: (caller: Caller) => Promise<PersonId>
}

// changes.*, and the seen marks and members the change log names
export function registerChanges({ router, notifier, undo, requireWorkspace, personAt }: Deps) {
  const rel = z.string()
  router.register(
    "changes.undo",
    z.object({ id: z.string().min(1) }),
    { touches: "own", target: async ({ id }) => ({ what: "change", by: (await requireWorkspace().changes.get(id))?.actor }) },
    ({ id }, caller) => undo.undo(id, caller),
  )
  router.register(
    "changes.undoPart",
    z.object({ id: z.string().min(1), index: z.number().int().min(0) }),
    { touches: "own", target: async ({ id }) => ({ what: "change", by: (await requireWorkspace().changes.get(id))?.actor }) },
    ({ id, index }, caller) => undo.undoPart(id, index, caller),
  )
  router.register("changes.passages", z.object({ id: z.string().min(1) }), "read", ({ id }) => undo.passagesOf(id))
  router.register("changes.stats", z.object({ ids: z.array(z.string().min(1)).min(1) }), "read", ({ ids }) => undo.stats(ids))
  const actor = z.custom<ActorId>((v) => typeof v === "string" && /^([po]_[0-9a-f]+|other)$/.test(v))
  router.register(
    "changes.list",
    z.object({
      target: z.object({ kind: z.enum(["doc", "comment", "paper", "thread", "memory"]), path: z.string(), part: z.string() }).partial().optional(),
      path: z.string().optional(),
      chatId: z.string().optional(),
      actor: actor.optional(),
      since: z.number().optional(),
    }), "read",
    (filter) => requireWorkspace().changes.list(filter),
  )
  router.register("members.get", noParams, "read", () => requireWorkspace().members.get())
  router.register("changes.unseen", z.object({ since: z.number().optional() }), "read", async ({ since }, caller) => {
    const ws = requireWorkspace()
    const me = await personAt(caller)
    const marks = await ws.seen.get(me, ["chats"])
    // A chat owlit started is never news as a chat (chats.list leaves it out): its work is, where it lands
    const [changes, chatList, { papers }] = await Promise.all([ws.changes.list(), ws.chats.list(), ws.library.list()])
    // Only the chats that moved after the person's mark on them can have a reply they haven't seen
    const moved = chatList.filter((c) => (marks.chats[c.id]?.at ?? Infinity) < c.updatedAt)
    const chats = (await Promise.all(moved.map((c) => ws.chats.get(c.id).catch(() => null)))).filter((c) => c !== null)
    return ws.seen.unseen(me, { changes, chats, papers, since })
  })
  router.register("changes.since", z.object({ path: rel, hash: z.string().min(1), text: z.string() }), "read", async ({ path, hash, text }, caller) => {
    const ws = requireWorkspace()
    return docPassages(ws.changes, path, hash, text, await personAt(caller))
  })
  router.register("changes.proposals", z.object({ path: rel, text: z.string(), hash: z.string().min(1).optional(), since: z.number().optional() }), "read", ({ path, text, hash, since }) =>
    docProposals(requireWorkspace().changes, path, text, { ...(hash !== undefined ? { hash } : {}), ...(since !== undefined ? { since } : {}) }),
  )
  const seenKind = z.enum(["docs", "threads", "chats", "comments", "digests"])
  router.register("seen.get", z.object({ kinds: z.array(seenKind).optional() }), "read", async ({ kinds }, caller) => requireWorkspace().seen.get(await personAt(caller), kinds))
  const at = { at: z.number().optional() }
  router.register(
    "seen.mark",
    z.union([
      z.object({ kind: z.literal("doc"), path: z.string().min(1), hash: z.string().min(1), ...at }),
      z.object({ kind: z.literal("thread"), id: z.string().min(1), items: z.array(z.string().min(1)), ...at }),
      z.object({ kind: z.literal("chat"), id: z.string().min(1), message: z.string().min(1), ...at }),
      z.object({ kind: z.literal("comments"), path: z.string().min(1), ...at }),
      z.object({ kind: z.literal("digest"), paper: z.string().min(1), ...at }),
    ]), "admin",
    async (mark, caller) => {
      const ws = requireWorkspace()
      const marks = await ws.seen.mark(await personAt(caller), mark)
      notifier.notify("seen.changed", marks)
      // A shared doc held for Owlit's unseen edits goes out now
      if (mark.kind === "doc") ws.shares.touched({ docs: [mark.path] })
      return marks
    },
  )
}
