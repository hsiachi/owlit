// SPIKE, not part of the product (local/work/2026-10-20-devweb-on-core): can a browser tab reach core?
//
// Bundles core the way the desktop app does (apps/desktop/scripts/shared.mjs, so Lingui's macros compile),
// starts it on a temp data folder with a scratch copy of the example workspace open, and serves its JSON-RPC
// over a WebSocket on 127.0.0.1. The renderer reaches it when Vite is started with
// VITE_OWLIT_CORE=ws://127.0.0.1:5182 (app/src/lib/rpc.ts, the lines marked SPIKE).
//
//   node scripts/spike-devweb-core.mjs
//   VITE_OWLIT_CORE=ws://127.0.0.1:5182 pnpm --dir app dev --port 5188
//
// One JSON-RPC request per message, one response back; notifications are pushed as they come. No auth: it
// listens on the loopback only. Nothing here is polished on purpose.

import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { esbuildOptions } from "../apps/desktop/scripts/shared.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PORT = Number(process.env.OWLIT_SPIKE_PORT) || 5182

// esbuild lives in the desktop package; ws is somewhere in pnpm's store (a dependency's dependency)
const desktopRequire = createRequire(path.join(root, "apps/desktop/package.json"))
const coreRequire = createRequire(path.join(root, "packages/core/package.json"))
const wsDir = readdirSync(path.join(root, "node_modules/.pnpm")).find((name) => name.startsWith("ws@"))
if (!wsDir) throw new Error("ws isn't in node_modules/.pnpm")
const { WebSocketServer } = createRequire(path.join(root, "node_modules/.pnpm", wsDir, "node_modules/ws/package.json"))("ws")

// Bundle core to a temp folder, then load it as the desktop's main would
const scratch = mkdtempSync(path.join(tmpdir(), "owlit-spike-"))
const options = esbuildOptions({ production: false, channel: "dev" })
await desktopRequire("esbuild").build({
  ...options,
  entryPoints: { core: path.join(root, "packages/core/src/index.ts") },
  outdir: scratch,
  sourcemap: false,
})
const { Core } = createRequire(import.meta.url)(path.join(scratch, "core.cjs"))

// A scratch workspace: the example one the first-launch flow offers, copied
const userDataDir = path.join(scratch, "userData")
const workspace = path.join(scratch, "workspace")
cpSync(path.join(root, "apps/desktop/resources/example-workspace"), workspace, { recursive: true })

const core = new Core({
  userDataDir,
  appVersion: "0.0.0-spike",
  debug: true,
  pdfiumWasm: coreRequire.resolve("@embedpdf/pdfium/pdfium.wasm"),
  // No socket, no extension server, no agents: this spike is about the window's RPC alone
  socket: false,
  extension: false,
})
core.start()
const info = await core.openWorkspace(workspace)
console.log(`[spike] core ${Core.name} open on ${info.path}`)
// The chat's agent: core's own fake engine (agents/fake-acp.ts, no model, no sign-in), added the way
// scripts/drive.mjs on the e2e-harness branch adds it
const fakeEngine = path.join(root, "packages/core/src/agents/fake-acp.ts")
const added = await core.handle({ jsonrpc: "2.0", id: 0, method: "agents.add", params: { name: "Fake engine", command: `"${process.execPath}" "${fakeEngine}"` } })
console.log(`[spike] fake engine ${"result" in added ? added.result.id : `not added: ${added.error.message}`}`)

const server = new WebSocketServer({ host: "127.0.0.1", port: PORT })
server.on("connection", (socket) => {
  console.log("[spike] a tab connected")
  const unsubscribe = core.onNotify((notification) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(notification))
  })
  socket.on("message", async (data) => {
    const request = JSON.parse(String(data))
    const response = await core.handle(request)
    console.log(`[spike] ${request.method} → ${"error" in response ? `error ${response.error.code} ${response.error.message}` : "ok"}`)
    socket.send(JSON.stringify(response))
  })
  socket.on("close", () => {
    unsubscribe()
    console.log("[spike] a tab left")
  })
})
console.log(`[spike] listening on ws://127.0.0.1:${PORT}; data in ${scratch}`)

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close()
    await core.dispose()
    rmSync(scratch, { recursive: true, force: true })
    process.exit(0)
  })
}
