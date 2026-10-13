import type { ShareBundle, ShareComment, ShareView } from "@owlit/protocol"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// What every share server answers, the same way: run against the Node server (server.test.ts) and the
// Cloudflare worker (apps/share-worker). owlit and the reader's page rely on exactly this.

export interface Target {
  base: string
  // How readers hear of changes: server-sent events (Node) or a WebSocket (the worker)
  live: "events" | "socket"
  close: () => Promise<void>
}

export const sampleBundle: ShareBundle = {
  version: 1,
  title: "Survey draft",
  author: "Zhang San",
  markdown: "Judges agree with people over 80% of the time ([Zheng 2023](owlit://library/zheng23)).",
  papers: { zheng23: { id: "zheng23", title: "Judging LLM-as-a-Judge", authors: ["Lianmin Zheng"], year: 2023, digest: "A digest." } },
}

// Hears a share's changes the way the reader's page does; next() waits for one of a kind
async function listen(target: Target, id: string) {
  const seen: string[] = []
  const waiters: (() => void)[] = []
  const heard = (type: string) => {
    seen.push(type)
    for (const w of waiters.splice(0)) w()
  }
  let close: () => void
  if (target.live === "socket") {
    const ws = new WebSocket(`${target.base.replace(/^http/, "ws")}/api/shares/${id}/socket`)
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve())
      ws.addEventListener("error", () => reject(new Error("the socket didn't open")))
    })
    ws.addEventListener("message", (e) => heard((JSON.parse(String(e.data)) as { type: string }).type))
    close = () => ws.close()
  } else {
    const controller = new AbortController()
    const res = await fetch(`${target.base}/api/shares/${id}/events`, { signal: controller.signal })
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    const reader = res.body!.getReader()
    await reader.read()
    void (async () => {
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) return
          buffer += decoder.decode(value)
          for (const m of buffer.matchAll(/event: (\w+)/g)) heard(m[1])
          buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2)
        }
      } catch {
        // Aborted
      }
    })()
    close = () => controller.abort()
  }
  return {
    next: async (type: string) => {
      const end = Date.now() + 5000
      while (!seen.includes(type)) {
        if (Date.now() > end) throw new Error(`no ${type} event`)
        await new Promise<void>((resolve) => {
          waiters.push(resolve)
          setTimeout(resolve, 100)
        })
      }
      seen.splice(seen.indexOf(type), 1)
    },
    close: () => close(),
  }
}

export function shareContract(start: () => Promise<Target>) {
  let target: Target
  beforeAll(async () => {
    target = await start()
  }, 60_000)
  afterAll(() => target?.close())

  const call = (method: string, url: string, body?: unknown, token?: string) =>
    fetch(target.base + url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })

  async function create(bundle = sampleBundle) {
    const res = await call("POST", "/api/shares", { bundle })
    expect(res.status).toBe(201)
    return (await res.json()) as { id: string; token: string; url: string }
  }
  const anchor = { quote: "over 80%", prefix: "agree with people ", suffix: " of the time" }

  describe("a share server", () => {
    it("makes a share, gives readers its bundle and takes the author's changes", async () => {
      const { id, token, url } = await create()
      expect(url).toMatch(new RegExp(`/s/${id}$`))
      const view = (await (await call("GET", `/api/shares/${id}`)).json()) as ShareView
      expect(view.bundle).toEqual(sampleBundle)
      expect(view.permission).toBe("comment")
      expect(view.live === "socket").toBe(target.live === "socket")

      expect((await call("PUT", `/api/shares/${id}`, { bundle: { ...sampleBundle, title: "Changed" } })).status).toBe(403)
      expect((await call("PUT", `/api/shares/${id}`, { bundle: { ...sampleBundle, title: "Changed" }, permission: "view" }, token)).status).toBe(200)
      const after = (await (await call("GET", `/api/shares/${id}`)).json()) as ShareView
      expect(after.bundle.title).toBe("Changed")
      expect(after.permission).toBe("view")
    })

    it("keeps a bundle larger than a database row whole", async () => {
      // About 2.7 MB of Chinese text: more than one row of a Durable Object's SQLite holds
      const big = { ...sampleBundle, markdown: "汉字".repeat(450_000) }
      const { id } = await create(big)
      const view = (await (await call("GET", `/api/shares/${id}`)).json()) as ShareView
      expect(view.bundle.markdown.length).toBe(900_000)
      expect(view.bundle.markdown).toBe(big.markdown)
    })

    it("refuses what it can't read", async () => {
      expect((await call("POST", "/api/shares", { bundle: { version: 2 } })).status).toBe(400)
      expect((await call("GET", "/api/shares/nope")).status).toBe(404)
      expect((await call("GET", "/api/shares/AAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404)
    })

    it("takes comments and replies, and only the author resolves them", async () => {
      const { id, token } = await create()
      const res = await call("POST", `/api/shares/${id}/comments`, { anchor, name: "Prof. Wang", text: "Ties counted?" })
      expect(res.status).toBe(201)
      const first = (await res.json()) as ShareComment
      expect(first).toMatchObject({ anchor, name: "Prof. Wang", by: "reader" })

      const reply = (await (await call("POST", `/api/shares/${id}/comments`, { parent: first.id, name: "Zhang San", text: "No ties." }, token)).json()) as ShareComment
      expect(reply).toMatchObject({ parent: first.id, anchor: null, by: "author" })
      // A reply to a reply joins the thread's first comment
      const deeper = (await (await call("POST", `/api/shares/${id}/comments`, { parent: reply.id, name: "Prof. Wang", text: "Thanks" })).json()) as ShareComment
      expect(deeper.parent).toBe(first.id)

      expect((await call("PATCH", `/api/shares/${id}/comments/${first.id}`, { resolved: true })).status).toBe(403)
      expect((await call("PATCH", `/api/shares/${id}/comments/${first.id}`, { resolved: true }, token)).status).toBe(204)
      expect((await call("PATCH", `/api/shares/${id}/comments/nothing`, { resolved: true }, token)).status).toBe(404)
      const comments = (await (await call("GET", `/api/shares/${id}/comments`)).json()) as ShareComment[]
      expect(comments.map((c) => c.text)).toEqual(["Ties counted?", "No ties.", "Thanks"])
      expect(comments[0].resolved).toBe(true)
    })

    it("lets readers only read a view-only share", async () => {
      const { id, token } = await create()
      await call("PUT", `/api/shares/${id}`, { permission: "view" }, token)
      expect((await call("POST", `/api/shares/${id}/comments`, { anchor, name: "A", text: "x" })).status).toBe(403)
      // The author still answers
      const res = await call("POST", `/api/shares/${id}/comments`, { anchor, name: "Zhang San", text: "A note" }, token)
      expect(res.status).toBe(201)
    })

    it("checks what a comment carries", async () => {
      const { id } = await create()
      expect((await call("POST", `/api/shares/${id}/comments`, { anchor, name: "", text: "x" })).status).toBe(400)
      expect((await call("POST", `/api/shares/${id}/comments`, { name: "A", text: "on nothing" })).status).toBe(400)
      expect((await call("POST", `/api/shares/${id}/comments`, { anchor, name: "A", text: "x".repeat(5000) })).status).toBe(400)
      expect((await call("POST", `/api/shares/${id}/comments`, { parent: "nothing", name: "A", text: "x" })).status).toBe(400)
    })

    it("stops a share: readers see it stopped, the author still reads the comments", async () => {
      const { id, token } = await create()
      await call("POST", `/api/shares/${id}/comments`, { anchor, name: "A", text: "x" })
      expect((await call("DELETE", `/api/shares/${id}`)).status).toBe(403)
      expect((await call("DELETE", `/api/shares/${id}`, undefined, token)).status).toBe(204)
      expect((await call("GET", `/api/shares/${id}`)).status).toBe(410)
      expect((await call("GET", `/api/shares/${id}/comments`)).status).toBe(410)
      expect((await call("GET", `/api/shares/${id}/comments`, undefined, token)).status).toBe(200)
      expect((await call("PUT", `/api/shares/${id}`, { bundle: sampleBundle }, token)).status).toBe(410)
    })

    it("tells readers following a share when it changes, gets comments, or stops", async () => {
      const { id, token } = await create()
      const live = await listen(target, id)
      await call("PUT", `/api/shares/${id}`, { bundle: { ...sampleBundle, title: "New" } }, token)
      await live.next("update")
      await call("POST", `/api/shares/${id}/comments`, { anchor, name: "A", text: "x" })
      await live.next("comments")
      await call("DELETE", `/api/shares/${id}`, undefined, token)
      await live.next("stopped")
      live.close()
    })

    it("serves the reader's page for every share link, with headers that keep it to itself", async () => {
      const page = await fetch(`${target.base}/s/abcdefghijklmnop`)
      expect(page.status).toBe(200)
      expect(page.headers.get("referrer-policy")).toBe("no-referrer")
      expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'")
      expect(page.headers.get("x-robots-tag")).toContain("noindex")
      expect(await page.text()).toContain("<div id=\"root\">")
    })
  })
}
