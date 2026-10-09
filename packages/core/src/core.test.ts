import { RpcErrorCode, type RpcNotification } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { Core } from "./core.ts"
import { Router } from "./rpc/index.ts"

const request = (method: string, params?: unknown, id = 1) => ({ jsonrpc: "2.0" as const, id, method, params })

describe("Core", () => {
  it("answers core.ping without Electron", async () => {
    const core = new Core()
    expect(await core.handle(request("core.ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } })
  })

  it("reports its version", async () => {
    const core = new Core({ appVersion: "1.2.3" })
    const response = await core.handle(request("core.version", {}))
    expect(response).toMatchObject({ result: { version: "1.2.3", node: process.versions.node } })
  })

  it("says hello once when started", () => {
    const core = new Core()
    const heard: RpcNotification[] = []
    const off = core.onNotify((n) => heard.push(n))
    core.start()
    core.start()
    off()
    core.dispose()
    core.start()
    expect(heard).toEqual([{ jsonrpc: "2.0", method: "core.hello", params: expect.objectContaining({ version: "0.0.0" }) }])
  })

  it("answers an unknown method with a code and a readable message", async () => {
    const response = await new Core().handle(request("docs.nope"))
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: RpcErrorCode.MethodNotFound, message: "owlit doesn't know how to do docs.nope." },
    })
  })

  it("rejects params on a method that takes none", async () => {
    const response = await new Core().handle(request("core.ping", { extra: true }))
    expect(response).toMatchObject({ error: { code: RpcErrorCode.InvalidParams } })
  })

  it("rejects a malformed envelope", async () => {
    const response = await new Core().handle({ id: 7, method: "core.ping" } as never)
    expect(response).toMatchObject({ id: 7, error: { code: RpcErrorCode.InvalidRequest } })
  })
})

describe("Router", () => {
  it("checks params and turns a thrown error into InternalError", async () => {
    const router = new Router()
    router.register("core.version" as never, z.object({ n: z.number() }) as never, ((p: { n: number }) => {
      if (p.n < 0) throw new Error("negative")
      return { n: p.n }
    }) as never)
    expect(await router.handle(request("core.version", { n: 2 }))).toMatchObject({ result: { n: 2 } })
    expect(await router.handle(request("core.version", { n: "x" }))).toMatchObject({
      error: { code: RpcErrorCode.InvalidParams },
    })
    const failed = await router.handle(request("core.version", { n: -1 }))
    expect(failed).toMatchObject({
      error: { code: RpcErrorCode.InternalError, message: "Something went wrong inside owlit.", data: { detail: "negative" } },
    })
  })
})
