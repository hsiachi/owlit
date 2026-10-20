import { t } from "@lingui/core/macro"
import { RpcErrorCode } from "@owlit/protocol"
import { z } from "zod"
import { noParams, RpcFailure, type Router } from "../rpc/index.ts"
import type { ExtensionServer } from "./server.ts"

interface Deps {
  router: Router
  // None where core doesn't serve the extension (the CLI, tests without one)
  extension: ExtensionServer | null
}

export function registerExtension({ router, extension }: Deps) {
  router.register("extension.get", noParams, "read", async () => (await extension?.view()) ?? { serving: false, portTaken: false, paired: [], asking: [], waits: [] })
  router.register("extension.answer", z.object({ id: z.string().min(1), allow: z.boolean() }), "admin", async ({ id, allow }) => {
    await extension?.pairings.answer(id, allow)
    return null
  })
  router.register("extension.open", z.object({ kind: z.enum(["sign-in", "check", "permission"]), host: z.string().min(1).max(253) }), "admin", async ({ kind, host }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    return extension.open(kind, host)
  })
  router.register("extension.forget", z.object({ id: z.string().min(1) }), "admin", async ({ id }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    await extension.pairings.forget(id)
    return extension.view()
  })
}
