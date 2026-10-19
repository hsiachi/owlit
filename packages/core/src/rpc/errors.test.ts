import { RpcErrorCode } from "@owlit/protocol"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Router, WINDOW } from "./router.ts"
import { z } from "zod"

afterEach(() => {
  vi.restoreAllMocks()
})

const failing = (error: unknown) => {
  const router = new Router()
  router.register("docs.read", z.object({ path: z.string() }), "read", async () => {
    throw error
  })
  return router.handle({ jsonrpc: "2.0", id: 1, method: "docs.read", params: { path: "writing/draft.md" } }, WINDOW)
}

const errnoError = (code: string, file: string) => Object.assign(new Error(`${code}: operation failed, rename '${file}'`), { code, path: file })

describe("errors a handler didn't expect", () => {
  it("name the file and the cause for a file system error, and log it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const locked = await failing(errnoError("EPERM", "/ws/writing/draft.md"))
    expect(locked).toMatchObject({ error: { code: RpcErrorCode.Forbidden, message: expect.stringContaining("draft.md") } })
    const full = await failing(errnoError("ENOSPC", "/ws/writing/draft.md"))
    expect(full).toMatchObject({ error: { message: "The disk is full, so draft.md couldn't be saved." } })
    expect(logged).toHaveBeenCalledTimes(2)
    expect(String(logged.mock.calls[0][0])).toContain("docs.read")
  })

  it("keep the general sentence for anything else, with the cause in detail and the log", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const answer = await failing(new TypeError("x is undefined"))
    expect(answer).toMatchObject({ error: { code: RpcErrorCode.InternalError, message: "Something went wrong inside owlit.", data: { detail: "x is undefined" } } })
    expect(logged).toHaveBeenCalledOnce()
  })
})
