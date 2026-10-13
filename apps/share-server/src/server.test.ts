import type { ShareBundle, ShareComment, ShareView } from "@owlit/protocol"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createShareServer } from "./server.ts"
import { Store } from "./store.ts"

const bundle: ShareBundle = {
  version: 1,
  title: "Survey draft",
  author: "Zhang San",
  markdown: "Judges agree with people over 80% of the time ([Zheng 2023](owlit://library/zheng23)).",
  papers: { zheng23: { id: "zheng23", title: "Judging LLM-as-a-Judge", authors: ["Lianmin Zheng"], year: 2023, digest: "A digest." } },
}

let dir: string
let server: Server
let base: string
let share: ReturnType<typeof createShareServer>
let store: Store

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "owlit-share-"))
  await mkdir(path.join(dir, "web", "assets"), { recursive: true })
  await writeFile(path.join(dir, "web", "index.html"), "<!doctype html><title>reader</title>")
  await writeFile(path.join(dir, "web", "assets", "app.js"), "console.log(1)")
  store = new Store(path.join(dir, "share.db"))
  share = createShareServer({ store, publicUrl: "https://share.example.org", staticDir: path.join(dir, "web") })
  server = createServer((req, res) => void share.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterEach(async () => {
  share.close()
  await new Promise((resolve) => server.close(resolve))
  store.close()
  await rm(dir, { recursive: true, force: true })
})

const call = (method: string, url: string, body?: unknown, token?: string) =>
  fetch(base + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function create() {
  const res = await call("POST", "/api/shares", { bundle })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; token: string; url: string }
}

describe("share server", () => {
  it("makes a share, gives readers its bundle and takes the author's changes", async () => {
    const { id, token, url } = await create()
    expect(url).toBe(`https://share.example.org/s/${id}`)
    const view = (await (await call("GET", `/api/shares/${id}`)).json()) as ShareView
    expect(view.bundle.title).toBe("Survey draft")
    expect(view.permission).toBe("comment")

    expect((await call("PUT", `/api/shares/${id}`, { bundle: { ...bundle, title: "Changed" } })).status).toBe(403)
    expect((await call("PUT", `/api/shares/${id}`, { bundle: { ...bundle, title: "Changed" }, permission: "view" }, token)).status).toBe(200)
    const after = (await (await call("GET", `/api/shares/${id}`)).json()) as ShareView
    expect(after.bundle.title).toBe("Changed")
    expect(after.permission).toBe("view")
  })

  it("refuses a bundle it can't read", async () => {
    expect((await call("POST", "/api/shares", { bundle: { version: 2 } })).status).toBe(400)
    expect((await call("GET", "/api/shares/nope")).status).toBe(404)
  })

  it("takes comments and replies, and only the author resolves them", async () => {
    const { id, token } = await create()
    const anchor = { quote: "over 80%", prefix: "agree with people ", suffix: " of the time" }
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
    const comments = (await (await call("GET", `/api/shares/${id}/comments`)).json()) as ShareComment[]
    expect(comments.map((c) => c.text)).toEqual(["Ties counted?", "No ties.", "Thanks"])
    expect(comments[0].resolved).toBe(true)
  })

  it("lets readers only read a view-only share", async () => {
    const { id, token } = await create()
    await call("PUT", `/api/shares/${id}`, { permission: "view" }, token)
    const res = await call("POST", `/api/shares/${id}/comments`, { anchor: { quote: "80%", prefix: "", suffix: "" }, name: "A", text: "x" })
    expect(res.status).toBe(403)
  })

  it("checks what a comment carries", async () => {
    const { id } = await create()
    expect((await call("POST", `/api/shares/${id}/comments`, { anchor: { quote: "80%", prefix: "", suffix: "" }, name: "", text: "x" })).status).toBe(400)
    expect((await call("POST", `/api/shares/${id}/comments`, { name: "A", text: "on nothing" })).status).toBe(400)
    expect((await call("POST", `/api/shares/${id}/comments`, { anchor: { quote: "80%", prefix: "", suffix: "" }, name: "A", text: "x".repeat(5000) })).status).toBe(400)
  })

  it("stops a share: readers see it stopped, the author still reads the comments", async () => {
    const { id, token } = await create()
    await call("POST", `/api/shares/${id}/comments`, { anchor: { quote: "80%", prefix: "", suffix: "" }, name: "A", text: "x" })
    expect((await call("DELETE", `/api/shares/${id}`)).status).toBe(403)
    expect((await call("DELETE", `/api/shares/${id}`, undefined, token)).status).toBe(204)
    expect((await call("GET", `/api/shares/${id}`)).status).toBe(410)
    expect((await call("GET", `/api/shares/${id}/comments`)).status).toBe(410)
    expect((await call("GET", `/api/shares/${id}/comments`, undefined, token)).status).toBe(200)
    expect((await call("PUT", `/api/shares/${id}`, { bundle }, token)).status).toBe(410)
  })

  it("tells readers following a share when it changes", async () => {
    const { id, token } = await create()
    const controller = new AbortController()
    const events = await fetch(`${base}/api/shares/${id}/events`, { signal: controller.signal })
    expect(events.headers.get("content-type")).toBe("text/event-stream")
    const reader = events.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ""
    await reader.read()
    await call("PUT", `/api/shares/${id}`, { bundle: { ...bundle, title: "New" } }, token)
    while (!seen.includes("event: update")) seen += decoder.decode((await reader.read()).value)
    await call("POST", `/api/shares/${id}/comments`, { anchor: { quote: "80%", prefix: "", suffix: "" }, name: "A", text: "x" })
    while (!seen.includes("event: comments")) seen += decoder.decode((await reader.read()).value)
    controller.abort()
  })

  it("serves the reader's page for every share link, and nothing outside its folder", async () => {
    const page = await fetch(`${base}/s/abcdefghijklmnop`)
    expect(page.status).toBe(200)
    expect(page.headers.get("referrer-policy")).toBe("no-referrer")
    expect(page.headers.get("content-security-policy")).toContain("connect-src 'self'")
    expect(await page.text()).toContain("reader")
    expect((await fetch(`${base}/assets/app.js`)).status).toBe(200)
    expect((await fetch(`${base}/..%2Fshare.db`)).status).toBe(404)
  })
})
