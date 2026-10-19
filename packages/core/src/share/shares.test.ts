import type { DocShare, RpcNotification, ShareComment, ShareView } from "@owlit/protocol"
import { createShareServer } from "@owlit/share-server/server"
import { Store } from "@owlit/share-server/store"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Core } from "../core.ts"
import { until } from "../test-util.ts"

// owlit and a real share server, talking over HTTP on this machine

let server: Server
let store: Store
let share: ReturnType<typeof createShareServer>
let base: string
let core: Core
let root: string
let heard: RpcNotification[]

const request = (method: string, params?: unknown) => ({ jsonrpc: "2.0" as const, id: 1, method, params })
async function call<T = unknown>(method: string, params?: unknown): Promise<T> {
  const response = await core.handle(request(method, params))
  if ("error" in response) throw new Error(response.error.message)
  return response.result as T
}
const reader = (url: string, init?: RequestInit) => fetch(base + url, { ...init, headers: { "content-type": "application/json", ...init?.headers } })

function putPaper(id: string, record: object, extra: { digest?: string; note?: string } = {}) {
  const dir = path.join(root, "library/papers", id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "paper.json"), JSON.stringify({ version: 1, authors: [], fields: {}, ...record }))
  if (extra.digest) writeFileSync(path.join(dir, "digest.md"), extra.digest)
  if (extra.note) writeFileSync(path.join(dir, "note.md"), extra.note)
}

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "owlit-share-core-"))
  store = new Store(path.join(dir, "share.db"))
  // Links point wherever the server says; here it is the test's own address, set once it listens
  server = createServer((req, res) => void share.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  share = createShareServer({ store, publicUrl: base })

  root = path.join(dir, "Research")
  mkdirSync(root)
  putPaper("zheng23", { title: "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena", authors: ["Lianmin Zheng"], year: 2023, venue: "NeurIPS", ids: { arxiv: "2306.05685" } }, {
    digest: "# Judging LLM-as-a-Judge\n\nStrong judges agree with people. See [figure](figure-3).",
    note: "80% leaves out ties (Table 5). Compare [[Ideas]].",
  })
  putPaper("wang23", { title: "Large Language Models are not Fair Evaluators", authors: ["Peiyi Wang"], year: 2023, ids: { doi: "10.18653/v1/2024.acl-long.511" } })
  writeFileSync(path.join(root, "Survey.md"), "# Survey\n\nJudges agree over 80% ([Zheng 2023](owlit://library/zheng23)). <!-- ask Wang -->\nSee [[Plan]] and [my chat](owlit://chat/c1).\n")
  writeFileSync(path.join(root, "Plan.md"), "private plan\n")

  core = new Core({ userDataDir: path.join(dir, "user"), shareServer: base, shareTimings: { settleMs: 30, pollMs: 100 } })
  heard = []
  core.onNotify((n) => heard.push(n))
  await call("workspace.open", { path: root })
})

afterEach(async () => {
  await core.dispose()
  share.close()
  await new Promise((resolve) => server.close(resolve))
  store.close()
})

const view = async (id: string) => (await (await reader(`/api/shares/${id}`)).json()) as ShareView

describe("sharing a doc", () => {
  it("pushes the doc and the papers it cites, with nothing that points into the workspace", async () => {
    const shared = await call<DocShare>("share.create", { path: "Survey.md", notes: true })
    expect(shared).toMatchObject({ path: "Survey.md", permission: "comment", notes: true, papers: 1 })
    expect(shared.url).toBe(`${base}/s/${shared.id}`)

    const { bundle } = await view(shared.id)
    expect(bundle.title).toBe("Survey")
    expect(bundle.markdown).toBe("# Survey\n\nJudges agree over 80% ([Zheng 2023](owlit://library/zheng23)). \nSee Plan and my chat.\n")
    expect(bundle.papers.zheng23).toMatchObject({
      title: "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena",
      url: "https://arxiv.org/abs/2306.05685",
      digest: "# Judging LLM-as-a-Judge\n\nStrong judges agree with people. See figure.",
      note: "80% leaves out ties (Table 5). Compare Ideas.",
    })
    expect(bundle.papers.wang23).toBeUndefined()

    // The link is in the workspace; its key is only on this computer
    expect(JSON.parse(readFileSync(path.join(root, ".owlit/shares.json"), "utf8")).shares[0]).toMatchObject({ id: shared.id, path: "Survey.md" })
    expect(readFileSync(path.join(root, ".owlit/shares.json"), "utf8")).not.toContain("token")
  })

  it("sends every change: an edit, a newly cited paper, the notes switched off", async () => {
    const shared = await call<DocShare>("share.create", { path: "Survey.md", notes: true })
    const { modifiedAt } = await call<{ modifiedAt: number }>("docs.read", { path: "Survey.md" })
    await call("docs.write", { path: "Survey.md", content: "# Survey\n\nNow citing [Wang 2023](owlit://library/wang23) too, and [Zheng 2023](owlit://library/zheng23).\n", expectedModifiedAt: modifiedAt })
    await until(async () => Object.keys((await view(shared.id)).bundle.papers).length === 2)
    expect((await view(shared.id)).bundle.papers.wang23.url).toBe("https://doi.org/10.18653/v1/2024.acl-long.511")
    await until(() => heard.some((n) => n.method === "share.changed" && (n.params as { share: DocShare }).share?.papers === 2))

    // A note changed by another program reaches the reader too
    writeFileSync(path.join(root, "library/papers/zheng23/note.md"), "A new note.")
    await call("library.setNote", { paperId: "zheng23", content: "A new note." })
    await until(async () => (await view(shared.id)).bundle.papers.zheng23.note === "A new note.")

    await call("share.update", { path: "Survey.md", notes: false })
    expect((await view(shared.id)).bundle.papers.zheng23.note).toBeUndefined()
    await call("share.update", { path: "Survey.md", permission: "view" })
    expect((await view(shared.id)).permission).toBe("view")
  })

  it("brings readers' comments back, and the author replies and resolves", async () => {
    const shared = await call<DocShare>("share.create", { path: "Survey.md", notes: false })
    const posted = (await (
      await reader(`/api/shares/${shared.id}/comments`, { method: "POST", body: JSON.stringify({ anchor: { quote: "over 80%", prefix: "Judges agree ", suffix: " (Zheng" }, name: "Prof. Wang", text: "Ties?" }) })
    ).json()) as ShareComment
    await until(() => heard.some((n) => n.method === "share.comments" && (n.params as { comments: ShareComment[] }).comments.length === 1))
    expect(existsSync(path.join(root, `.owlit/shares/${shared.id}.json`))).toBe(true)

    const reply = await call<ShareComment>("share.reply", { path: "Survey.md", parent: posted.id, text: "No ties." })
    expect(reply).toMatchObject({ by: "author", parent: posted.id })
    await call("share.resolve", { path: "Survey.md", id: posted.id, resolved: true })
    const comments = await call<ShareComment[]>("share.comments", { path: "Survey.md" })
    expect(comments.map((c) => [c.text, !!c.resolved])).toEqual([
      ["Ties?", true],
      ["No ties.", false],
    ])
  })

  it("takes the link along when the doc is renamed", async () => {
    const shared = await call<DocShare>("share.create", { path: "Survey.md", notes: false })
    await call("docs.rename", { path: "Survey.md", name: "Related work" })
    await until(async () => (await call<{ shares: DocShare[] }>("share.list")).shares[0]?.path === "Related work.md")
    await until(async () => (await view(shared.id)).bundle.title === "Related work")
  })

  it("stops: the link stops working and the doc is no longer shared", async () => {
    const shared = await call<DocShare>("share.create", { path: "Survey.md", notes: false })
    await call("share.stop", { path: "Survey.md" })
    expect((await reader(`/api/shares/${shared.id}`)).status).toBe(410)
    expect((await call<{ shares: DocShare[] }>("share.list")).shares).toEqual([])
  })

  it("says plainly when no server is set up", async () => {
    const lonely = new Core({ userDataDir: mkdtempSync(path.join(tmpdir(), "owlit-noshare-")) })
    await lonely.handle(request("workspace.open", { path: mkdtempSync(path.join(tmpdir(), "owlit-noshare-ws-")) }))
    expect(await lonely.handle(request("share.list"))).toMatchObject({ result: { server: null, shares: [] } })
    expect(await lonely.handle(request("share.create", { path: "a.md", notes: false }))).toMatchObject({ error: { message: "No share server is set up, so owlit can't make links yet." } })
    await lonely.dispose()
  })
})
