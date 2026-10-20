import { t } from "@lingui/core/macro"
import { ROLES, RpcErrorCode, type ChatMessage, type Role } from "@owlit/protocol"
import { existsSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Turns } from "../agents/turns.ts"
import type { Host } from "../host.ts"
import { noParams, RpcFailure, type Router } from "../rpc/index.ts"
import type { Workspace } from "../workspace/workspace.ts"
import { attachFile, chatFile } from "./attach.ts"
import { tryAgain, type TurnAgent } from "./chats.ts"

// A chat's id as clients make them; agents.prompt names chats with the same
export const chatId = z.string().regex(/^[\w-]+$/)
export const roleSchema = z.enum(ROLES.map((r) => r.id) as [Role, ...Role[]])
// Messages are the app's own shape (protocol/chat.ts); core checks only what it relies on
export const messageSchema = z.looseObject({
  id: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()),
  createdAt: z.number(),
}) as unknown as z.ZodType<ChatMessage>

interface Deps {
  router: Router
  turns: Turns
  // The open workspace, or a NoWorkspace failure
  requireWorkspace: () => Workspace
  // What the machine offers beyond Node (opening a file in its app)
  host?: Host
  // The agent and model Settings chooses for Owlit's own work (Core.workAgent)
  workAgent: () => Promise<TurnAgent>
  // Tells every window a chat owlit started began or ended a turn (Core.announceStarted)
  announceStarted: (ws: Workspace, chatId: string) => Promise<void>
}

export function registerChats({ router, turns, requireWorkspace, host, workAgent, announceStarted }: Deps) {
  const chats = () => requireWorkspace().chats
  const chatId = z.string().regex(/^[\w-]+$/)
  const roleSchema = z.enum(ROLES.map((r) => r.id) as [Role, ...Role[]])
  const summary = z.object({
    id: chatId,
    title: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    pinned: z.boolean(),
    connectorId: z.string().optional(),
    modelId: z.string().optional(),
    role: roleSchema.optional(),
    effortId: z.string().optional(),
    help: z.literal(true).optional(),
  })
  // Messages are the app's own shape (protocol/chat.ts); core checks only what it relies on
  const message = z.looseObject({
    id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.unknown()),
    createdAt: z.number(),
  }) as unknown as z.ZodType<ChatMessage>
  router.register("chats.list", noParams, "read", () => chats().list())
  router.register("chats.startedFor", z.object({ kind: z.enum(["paper", "thread", "doc", "comment"]).optional() }), "read", ({ kind }) => chats().startedFor(kind))
  router.register("chats.tryAgain", z.object({ chatId }), "admin", async ({ chatId }) => {
    const ws = requireWorkspace()
    const started = await tryAgain(turns, ws.chats, chatId, await workAgent())
    await announceStarted(ws, started.chatId)
    return { chatId: started.chatId }
  })
  router.register("chats.get", z.object({ id: chatId }), "read", ({ id }) => chats().get(id))
  router.register("chats.create", z.object({ chat: summary }), "admin", ({ chat }) => chats().create(chat))
  router.register("chats.update", z.object({ id: chatId, patch: summary.omit({ id: true, createdAt: true }).partial() }), "admin", ({ id, patch }) =>
    chats().update(id, patch),
  )
  router.register("chats.delete", z.object({ id: chatId }), "admin", ({ id }) => chats().delete(id))
  router.register("chats.appendMessage", z.object({ id: chatId, message }), "admin", ({ id, message }) =>
    chats().appendMessage(id, message),
  )
  router.register("chats.removeMessages", z.object({ id: chatId, messageIds: z.array(z.string()) }), "admin", ({ id, messageIds }) =>
    chats().removeMessages(id, messageIds),
  )
  router.register("chats.patchMessage", z.object({ id: chatId, message, final: z.boolean().optional() }), "admin", ({ id, message, final }) =>
    chats().patchMessage(id, message, final),
  )
  router.register("chats.restore", z.object({ id: chatId }), "admin", ({ id }) => chats().restore(id))
  router.register(
    "chats.attach",
    z.object({ chatId, path: z.string().min(1).optional(), name: z.string().optional(), mimeType: z.string().optional(), data: z.string().optional() }), "admin",
    (params) => attachFile(requireWorkspace(), params),
  )
  router.register("chats.detach", z.object({ chatId, path: z.string() }), "admin", ({ chatId, path }) => chats().removeFile(chatId, chatFile(path)))
  router.register("chats.openFile", z.object({ path: z.string() }), "admin", async ({ path: rel }) => {
    const ws = requireWorkspace()
    if (!host?.openPath) throw new RpcFailure(RpcErrorCode.InternalError, t`owlit can't open files in other apps here.`)
    const file = path.join(ws.root, ...chatFile(rel).split("/"))
    if (!existsSync(file)) throw new RpcFailure(RpcErrorCode.NotFound, t`owlit no longer has that file.`, { path: rel })
    await host.openPath(file)
    return null
  })
}
