import { describe, expect, it } from "vitest"
import { Http, HttpError } from "./http.ts"

function fakeFetch(answer: (url: string, n: number) => Response | Promise<Response>) {
  const calls: { url: string; at: number; headers: Record<string, string> }[] = []
  const fetch = (async (input: string, init?: RequestInit) => {
    calls.push({ url: input, at: Date.now(), headers: init?.headers as Record<string, string> })
    return answer(input, calls.length)
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

describe("Http", () => {
  it("retries 5xx and 429, then succeeds", async () => {
    const { fetch, calls } = fakeFetch((_, n) => (n < 3 ? new Response("", { status: n === 1 ? 503 : 429 }) : Response.json({ ok: 1 })))
    const http = new Http({ fetch, userAgent: "owlit-test", retryBaseMs: 1 })
    expect(await http.json("https://api.example.org/x")).toEqual({ ok: 1 })
    expect(calls).toHaveLength(3)
    expect(calls[0].headers["user-agent"]).toBe("owlit-test")
  })

  it("doesn't retry a 404 and says so in a sentence", async () => {
    const { fetch, calls } = fakeFetch(() => new Response("", { status: 404 }))
    const http = new Http({ fetch, userAgent: "t", retryBaseMs: 1 })
    await expect(http.get("https://api.example.org/missing")).rejects.toMatchObject({
      status: 404,
      message: "api.example.org has no record of that.",
    })
    expect(calls).toHaveLength(1)
  })

  it("gives up after the retries with status 0 when the host can't be reached", async () => {
    const { fetch, calls } = fakeFetch(() => Promise.reject(new TypeError("fetch failed")))
    const http = new Http({ fetch, userAgent: "t", retryBaseMs: 1 })
    const error = await http.get("https://down.example.org/", { retries: 2 }).catch((e) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 0, message: "Couldn't reach down.example.org." })
    expect(calls).toHaveLength(3)
  })

  it("spaces requests to one host by its rate", async () => {
    const { fetch, calls } = fakeFetch(() => new Response("ok"))
    const http = new Http({ fetch, userAgent: "t" })
    http.limit("slow.example.org", { perSecond: 20 })
    await Promise.all([1, 2, 3, 4].map((i) => http.text(`https://slow.example.org/${i}`)))
    await http.text("https://fast.example.org/")
    const slow = calls.filter((c) => c.url.includes("slow")).map((c) => c.at)
    expect(slow.at(-1)! - slow[0]).toBeGreaterThanOrEqual(140)
  })

  it("stops waiting when aborted", async () => {
    const { fetch } = fakeFetch(() => new Response("", { status: 503 }))
    const http = new Http({ fetch, userAgent: "t", retryBaseMs: 10_000 })
    const controller = new AbortController()
    const pending = http.get("https://api.example.org/", { signal: controller.signal })
    setTimeout(() => controller.abort(new Error("cancelled")), 10)
    await expect(pending).rejects.toThrow("cancelled")
  })
})
