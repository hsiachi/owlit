import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ShareComment } from "@owlit/protocol"
import { describe, expect, it } from "vitest"
import { sampleBundle, shareContract, type Target } from "./contract.ts"
import { createShareServer } from "./server.ts"
import { Store } from "./store.ts"

// The Node server: an empty data folder and a stand-in for the reader's page
async function start(now?: () => number): Promise<Target> {
  const dir = await mkdtemp(path.join(tmpdir(), "owlit-share-"))
  await mkdir(path.join(dir, "web", "assets"), { recursive: true })
  await writeFile(path.join(dir, "web", "index.html"), '<!doctype html><title>reader</title><div id="root"></div>')
  await writeFile(path.join(dir, "web", "assets", "app.js"), "console.log(1)")
  const store = new Store(path.join(dir, "share.db"))
  const share = createShareServer({ store, publicUrl: "https://share.example.org", staticDir: path.join(dir, "web"), now })
  const server = createServer((req, res) => void share.handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    live: "events",
    close: async () => {
      share.close()
      await new Promise((resolve) => server.close(resolve))
      store.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe("the Node share server", () => {
  shareContract(start)

  it("serves the page's files, and nothing outside their folder", async () => {
    const target = await start()
    try {
      expect((await fetch(`${target.base}/assets/app.js`)).status).toBe(200)
      expect((await fetch(`${target.base}/..%2Fshare.db`)).status).toBe(404)
    } finally {
      await target.close()
    }
  })

  it("keeps comments made in the same millisecond in the order they came", async () => {
    const target = await start(() => 1_800_000_000_000)
    try {
      const { id } = (await (await fetch(`${target.base}/api/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bundle: sampleBundle }) })).json()) as { id: string }
      const post = (body: object) => fetch(`${target.base}/api/shares/${id}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const first = (await (await post({ anchor: { quote: "80%", prefix: "over ", suffix: " of" }, name: "A", text: "0" })).json()) as ShareComment
      for (let i = 1; i < 8; i++) await post({ parent: first.id, name: "A", text: String(i) })
      const comments = (await (await fetch(`${target.base}/api/shares/${id}/comments`)).json()) as ShareComment[]
      expect(comments.map((c) => c.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"])
    } finally {
      await target.close()
    }
  })
})
