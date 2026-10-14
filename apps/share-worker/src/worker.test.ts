import { shareContract } from "@owlit/share-server/contract"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { describe } from "vitest"
import { unstable_startWorker } from "wrangler"

// The worker in workerd, Cloudflare's runtime, on this machine: the same answers as the Node server. Tests send
// Cloudflare no usage reports.
process.env.WRANGLER_SEND_METRICS ??= "false"
const here = path.resolve(import.meta.dirname, "..")

describe("the Cloudflare share worker", () => {
  shareContract(async () => {
    // The reader's page is the worker's static assets; it has to be built for the worker to start
    if (!existsSync(path.join(here, "../share-web/dist/index.html"))) execFileSync("pnpm", ["--filter", "@owlit/share-web", "build"], { cwd: here, stdio: "ignore" })
    const worker = await unstable_startWorker({ config: path.join(here, "wrangler.jsonc"), dev: { server: { hostname: "127.0.0.1", port: 0 }, inspector: false, persist: false, logLevel: "warn" } })
    await worker.ready
    return { base: String(await worker.url).replace(/\/$/, ""), live: "socket", close: () => worker.dispose() }
  })
})
