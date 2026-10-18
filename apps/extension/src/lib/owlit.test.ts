import { afterEach, describe, expect, it, vi } from "vitest"

// Each test stubs chrome: lib/owlit.ts names the extension by its origin, read from the browser's API
afterEach(() => vi.unstubAllGlobals())

const answering = (status: number, owlit: string | null, body: object) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: owlit ? { "x-owlit-id": owlit, "x-owlit-name": encodeURIComponent("Owlit Dev (pdf-flow)") } : {} })),
  )

describe("asking owlit", () => {
  it("tells another owlit on the port apart, before its 401 can unpair this browser", async () => {
    vi.stubGlobal("chrome", { runtime: { getURL: () => "chrome-extension://abc/" } })
    const { ask, Elsewhere } = await import("./owlit.ts")
    answering(401, "preview", { reason: "not-paired", message: "" })
    const asked = ask("/status", { token: "t", owlit: "installed" })
    await expect(asked).rejects.toBeInstanceOf(Elsewhere)
    await expect(asked).rejects.toMatchObject({ owlitName: "Owlit Dev (pdf-flow)" })
  })

  it("hears the owlit it is paired with as before", async () => {
    vi.stubGlobal("chrome", { runtime: { getURL: () => "chrome-extension://abc/" } })
    const { ask, OwlitError } = await import("./owlit.ts")
    answering(401, "installed", { reason: "not-paired", message: "" })
    await expect(ask("/status", { token: "t", owlit: "installed" })).rejects.toBeInstanceOf(OwlitError)
    answering(200, "installed", { ok: true })
    expect(await ask("/status", { token: "t", owlit: "installed" })).toEqual({ ok: true })
    // Before pairing, any owlit answers
    answering(200, "preview", { state: "waiting" })
    expect(await ask("/pair/x")).toEqual({ state: "waiting" })
  })
})
