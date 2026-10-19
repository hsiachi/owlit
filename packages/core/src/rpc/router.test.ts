import { z } from "zod"
import { describe, expect, it } from "vitest"
import { Router, WINDOW } from "./router.ts"

describe("Router", () => {
  it("says which parameter it couldn't use, and why", async () => {
    const router = new Router()
    router.register("library.list" as never, z.object({ limit: z.number().max(50) }) as never, "read", () => ({ papers: [] }) as never)
    const response = await router.handle({ jsonrpc: "2.0", id: 1, method: "library.list", params: { limit: 100 } }, WINDOW)
    expect(response).toMatchObject({ error: { code: -32602, message: expect.stringMatching(/^library\.list got parameters it can't use: limit: .*50\.$/) } })
  })
})
