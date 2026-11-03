import { t } from "@lingui/core/macro"
import { RpcErrorCode, type WaitId } from "@owlit/protocol"
import { z } from "zod"
import { noParams, RpcFailure, type Router } from "../rpc/index.ts"
import type { ExtensionServer } from "./server.ts"

// A wait's id, as core made it (keys.ts)
const waitId = z
  .string()
  .max(300)
  .regex(/^(pub|site|proxy):./)
  .transform((id) => id as WaitId)

interface Deps {
  router: Router
  // None where core doesn't serve the extension (the CLI, tests without one)
  extension: ExtensionServer | null
}

export function registerExtension({ router, extension }: Deps) {
  router.register("extension.get", noParams, "read", async () => (await extension?.view()) ?? { serving: false, portTaken: false, paired: [], asking: [], waits: [], going: [], runs: [] })
  router.register("extension.answer", z.object({ id: z.string().min(1), allow: z.boolean() }), "admin", async ({ id, allow }) => {
    await extension?.pairings.answer(id, allow)
    return null
  })
  router.register("extension.open", z.object({ wait: waitId }), "admin", async ({ wait }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    return extension.open(wait)
  })
  router.register("extension.resume", z.object({ wait: waitId }), "admin", async ({ wait }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    return { resumed: extension.work.resumeWait(wait) }
  })
  router.register("extension.dismissGoing", z.object({ wait: waitId }), "admin", async ({ wait }) => {
    extension?.work.dismissGoing(wait)
    return null
  })
  router.register("extension.openPage", z.object({ url: z.string().max(4096).regex(/^https?:\/\//i) }), "admin", async ({ url }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    return extension.openPage(url)
  })
  router.register("extension.walk", z.object({ ids: z.array(z.string().min(1)).min(1).max(1000) }), "admin", async ({ ids }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    return extension.startWalk(ids)
  })
  router.register("extension.forget", z.object({ id: z.string().min(1) }), "admin", async ({ id }) => {
    if (!extension) throw new RpcFailure(RpcErrorCode.Unavailable, t`The browser extension needs the owlit desktop app.`)
    await extension.pairings.forget(id)
    return extension.view()
  })
}
