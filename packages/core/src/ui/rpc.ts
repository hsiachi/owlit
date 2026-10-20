import { RpcErrorCode } from "@owlit/protocol"
import { z } from "zod"
import { RpcFailure, type Caller, type Router } from "../rpc/index.ts"
import type { UiBridge } from "./bridge.ts"

interface Deps {
  router: Router
  ui: UiBridge
}

export function registerUi({ router, ui }: Deps) {
  // What a window says of itself: which docs it holds open (Owlit's writes to them go through it), its
  // answers to core's requests, its focus. Changing nothing, they pass the policy as reads, so a program
  // on the socket that said it held a doc open could take Owlit's writes and drop them: only a window
  // may say them.
  const windowOnly = (caller: Caller) => {
    if (caller.kind !== "window") throw new RpcFailure(RpcErrorCode.Forbidden, "Not done: only owlit's window says what it has open and answers its requests.")
  }
  router.register("ui.setOpenDocs", z.object({ clientId: z.string().min(1), paths: z.array(z.string()) }), "read", ({ clientId, paths }, caller) => {
    windowOnly(caller)
    return ui.setOpenDocs(clientId, paths)
  })
  router.register("ui.respond", z.object({ requestId: z.string(), result: z.unknown().optional(), error: z.string().optional() }), "read", ({ requestId, result, error }, caller) => {
    windowOnly(caller)
    return ui.respond(requestId, result, error)
  })
  router.register("ui.focus", z.object({ clientId: z.string().min(1) }), "read", ({ clientId }, caller) => {
    windowOnly(caller)
    return ui.focus(clientId)
  })
  router.register("ui.leave", z.object({ clientId: z.string().min(1) }), "read", ({ clientId }, caller) => {
    windowOnly(caller)
    return ui.leave(clientId)
  })
  const owlitUri = z.string().regex(/^owlit:\/\/[a-z]+\/.+/, "an owlit:// link")
  const asker = z.string().min(1).optional()
  router.register("ui.open", z.object({ uri: owlitUri, chatId: asker }), "read", (params) => ui.act("open", params))
  router.register("ui.jump", z.object({ uri: owlitUri, page: z.number().int().positive().optional(), quote: z.string().min(1).optional(), chatId: asker }), "read", (params) =>
    ui.act("jump", params),
  )
  router.register(
    "ui.mark",
    z.object({ uri: owlitUri, quote: z.string().min(1), color: z.enum(["yellow", "green", "blue", "pink"]).optional(), chatId: asker }), "own",
    (params) => ui.act("mark", params),
  )
}
