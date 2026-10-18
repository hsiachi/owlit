import type { WorkItem } from "@owlit/protocol"
import { describe, expect, it, vi } from "vitest"
import { OwlitError } from "./owlit.ts"
import { doWork, fetchFor, type FetchDeps } from "./work.ts"

const PDF = new TextEncoder().encode("%PDF-1.7\n...")
const item = (extra: Partial<WorkItem> = {}): WorkItem => ({ id: "w1", paperId: "doi-10.1177-1", url: "https://journals.sagepub.com/doi/10.1177/1", host: "sagepub.com", proxied: false, ...extra })

// A web of addresses: each answers with a body, a status and where its redirects ended
// "away": a redirect to a site the extension may not read, which a followed fetch rejects
type Answer = { body: string | Uint8Array; status?: number; type?: string; endsAt?: string } | "down" | "away"
function web(answers: Record<string, Answer>, permitted: (url: string) => boolean = () => true) {
  const asked: string[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    asked.push(url)
    expect(init?.credentials).toBe("include")
    const answer = answers[url] ?? { body: "<title>Not Found</title>", status: 404 }
    if (answer === "down") throw new TypeError("Failed to fetch")
    if (answer === "away") {
      if (init?.redirect !== "manual") throw new TypeError("Failed to fetch")
      return { type: "opaqueredirect", status: 0, url, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response
    }
    const response = new Response(answer.body as BodyInit, { status: answer.status ?? 200, headers: { "content-type": answer.type ?? (typeof answer.body === "string" ? "text/html" : "application/pdf") } })
    Object.defineProperty(response, "url", { value: answer.endsAt ?? url })
    return response
  }) as unknown as typeof globalThis.fetch
  const deps: FetchDeps = { fetch, permitted: async (url) => permitted(url) }
  return { deps, asked }
}

describe("fetching a paper for owlit", () => {
  it("takes the PDF the address gives", async () => {
    const { deps, asked } = web({ "https://journals.sagepub.com/doi/pdf/10.1177/1": { body: PDF } })
    const got = await fetchFor(item({ pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/1" }), deps)
    expect(got).toMatchObject({ host: "journals.sagepub.com" })
    expect("pdf" in got && new Uint8Array(got.pdf)).toEqual(PDF)
    expect(asked).toEqual(["https://journals.sagepub.com/doi/pdf/10.1177/1"])
  })

  it("hands over a PDF a server sent a line before, from its mark on", async () => {
    const late = new Uint8Array([10, 13, 10, ...PDF])
    const { deps } = web({ "https://journals.sagepub.com/doi/pdf/10.1177/1": { body: late } })
    const got = await fetchFor(item({ pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/1" }), deps)
    expect("pdf" in got && new Uint8Array(got.pdf)).toEqual(PDF)
  })

  it("follows the page's citation_pdf_url to its PDF", async () => {
    const page = `<html><head><title>A Paper</title><meta name="citation_title" content="A Paper"><meta name="citation_pdf_url" content="/doi/pdf/10.1177/1"></head></html>`
    const { deps, asked } = web({ "https://journals.sagepub.com/doi/10.1177/1": { body: page }, "https://journals.sagepub.com/doi/pdf/10.1177/1": { body: PDF } })
    const got = await fetchFor(item(), deps)
    expect("pdf" in got).toBe(true)
    expect(asked).toEqual(["https://journals.sagepub.com/doi/10.1177/1", "https://journals.sagepub.com/doi/pdf/10.1177/1"])
  })

  it("fetches past a check from a tab of that site the user got through in", async () => {
    const check = { body: "<title>Just a moment...</title>", status: 403 }
    const { deps } = web({ "https://dl.acm.org/doi/pdf/10.1145/1": check, "https://dl.acm.org/doi/10.1145/1": check })
    const inside = web({ "https://dl.acm.org/doi/pdf/10.1145/1": { body: PDF } })
    const hosts: string[] = []
    const acm = item({ url: "https://dl.acm.org/doi/10.1145/1", pdfUrl: "https://dl.acm.org/doi/pdf/10.1145/1", host: "acm.org" })
    const got = await fetchFor(acm, { ...deps, inTab: async (host) => (hosts.push(host), inside.deps.fetch) })
    expect("pdf" in got && new Uint8Array(got.pdf)).toEqual(PDF)
    expect(hosts).toEqual(["dl.acm.org"])
    // No such tab: the check stands
    expect(await fetchFor(acm, { ...deps, inTab: async () => undefined })).toMatchObject({ ended: "check", host: "dl.acm.org" })
  })

  it("says check for a check page, with its host and title but not its text", async () => {
    const { deps } = web({ "https://journals.sagepub.com/doi/10.1177/1": { body: "<title>Just a moment...</title><p>secret words</p>", status: 403 } })
    const got = await fetchFor(item(), deps)
    expect(got).toEqual({ ended: "check", host: "journals.sagepub.com", title: "Just a moment...", url: "https://journals.sagepub.com/doi/10.1177/1" })
  })

  it("says sign-in where the proxy sends it to sign in", async () => {
    const entry = "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/1"
    const { deps } = web({ [entry]: { body: "<title>Sign in</title>", endsAt: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/x" } })
    const got = await fetchFor(item({ url: entry, host: "tlink.lib.tsinghua.edu.cn", proxied: true }), deps)
    expect(got).toMatchObject({ ended: "sign-in", host: "id.tsinghua.edu.cn" })
  })

  it("says not there for a 404", async () => {
    const { deps } = web({})
    expect(await fetchFor(item({ pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/1" }), deps)).toMatchObject({ ended: "not-there", host: "journals.sagepub.com" })
  })

  it("fetches nothing on a site it may not read", async () => {
    const { deps, asked } = web({}, () => false)
    expect(await fetchFor(item(), deps)).toEqual({ ended: "no-permission", host: "sagepub.com" })
    expect(asked).toEqual([])
  })

  it("says offline when nothing answers, and when it is too slow", async () => {
    expect(await fetchFor(item(), web({ "https://journals.sagepub.com/doi/10.1177/1": "down" }).deps)).toMatchObject({ ended: "offline" })
    const aborted = (init: RequestInit) => new Promise<never>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    const never = { fetch: ((_: string, init: RequestInit) => aborted(init)) as unknown as typeof fetch, permitted: async () => true, timeoutMs: 5 }
    expect(await fetchFor(item(), never)).toMatchObject({ ended: "offline" })
    // The headers came, the body is still arriving when the time is up: a slow proxy with a large PDF
    const asked: string[] = []
    const slowBody = {
      fetch: (async (url: string, init: RequestInit) => {
        asked.push(url)
        return { ok: true, status: 200, type: "basic", url, headers: new Headers({ "content-type": "application/pdf" }), arrayBuffer: () => aborted(init) } as unknown as Response
      }) as unknown as typeof fetch,
      permitted: async () => true,
      timeoutMs: 5,
    }
    expect(await fetchFor(item({ pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/1" }), slowBody)).toEqual({ ended: "offline", host: "journals.sagepub.com" })
    // Not taken as a reason to try the article page after it
    expect(asked).toEqual(["https://journals.sagepub.com/doi/pdf/10.1177/1"])
  })

  it("says sign-in through the proxy, and no copy elsewhere, where a redirect leads to a site it may not read", async () => {
    // Signed out at the proxy: it sends the fetch on to the school's sign-in
    const entry = "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/10.1177/1"
    const proxied = await fetchFor(item({ url: entry, host: "tlink.lib.tsinghua.edu.cn", proxied: true }), web({ [entry]: "away" }).deps)
    expect(proxied).toEqual({ ended: "sign-in", host: "tlink.lib.tsinghua.edu.cn" })
    // Without a proxy, the redirect's target is unknown: no copy there, never a site to allow, since the
    // site it asked is one the extension already reads (allowing it again would change nothing)
    const { deps, asked } = web({ "https://journals.sagepub.com/doi/10.1177/1": "away" })
    expect(await fetchFor(item(), deps)).toEqual({ ended: "no-copy", host: "sagepub.com" })
    expect(asked).toEqual(["https://journals.sagepub.com/doi/10.1177/1", "https://journals.sagepub.com/doi/10.1177/1"])
    // The PDF's own address leading away: the page is tried, and its word stands
    const pdfAway = web({ "https://journals.sagepub.com/doi/pdf/10.1177/1": "away", "https://journals.sagepub.com/doi/10.1177/1": { body: "<title>Get access</title>" } })
    expect(await fetchFor(item({ pdfUrl: "https://journals.sagepub.com/doi/pdf/10.1177/1" }), pdfAway.deps)).toMatchObject({ ended: "no-access" })
    // Nothing answers either way: offline, as before
    expect(await fetchFor(item(), web({ "https://journals.sagepub.com/doi/10.1177/1": "down" }).deps)).toMatchObject({ ended: "offline" })
  })

  it("hands the PDF or the word to owlit, and lets go of an answer owlit no longer waits for", async () => {
    const ask = vi.fn(async () => ({}))
    const pdfWeb = web({ "https://journals.sagepub.com/doi/10.1177/1": { body: PDF } })
    await doWork(item(), { ...pdfWeb.deps, ask: ask as never, token: "t" })
    expect(ask).toHaveBeenLastCalledWith("/work/w1?host=journals.sagepub.com", expect.objectContaining({ method: "POST", token: "t", pdf: expect.any(ArrayBuffer) }))
    await doWork(item(), { ...web({}, () => false).deps, ask: ask as never, token: "t" })
    expect(ask).toHaveBeenLastCalledWith("/work/w1", { token: "t", json: { ended: "no-permission", host: "sagepub.com" } })
    const gone = vi.fn(async () => {
      throw new OwlitError(404, { reason: "not-found" })
    })
    await expect(doWork(item(), { ...web({}).deps, ask: gone as never, token: "t" })).resolves.toMatchObject({ ended: "not-there" })
  })
})
