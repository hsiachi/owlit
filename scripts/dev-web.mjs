// pnpm dev:web: the renderer in a browser on a dev core, so what an agent sees in a preview pane is what
// the app does. Core is bundled the way the desktop app bundles it (apps/desktop/scripts/shared.mjs) and
// runs in this process on app data of its own under the system temp folder, with a copy of the example
// workspace open and core's fake engine (packages/core/src/agents/fake-acp.ts) as an agent beside the ones
// on PATH; the owlit command and owlit-mcp reach that workspace as they reach any other (it prints how). The window's JSON-RPC rides a WebSocket, and owlit-file://workspace/<path> is served over http on
// the same port (app/src/lib/web-bridge.ts stands in for the preload). Both outlive the tab: reload the
// page and the data is still there; --fresh starts it over. A change to core needs a restart of this
// script; the renderer has Vite's HMR.
//
//   pnpm dev:web [--port <vite port>] [--core-port <port>] [--workspace <folder>] [--fresh] [--mocks]
//
// --workspace opens a folder as it is (never one of your real workspaces: what the app does to it, digests
// and comments, would be done for real). --mocks is the renderer alone on its mock data, without core.

import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"
import { checkoutLabel, realData } from "../apps/desktop/scripts/preview.mjs"
import { appDir, desktopDir, esbuildOptions } from "../apps/desktop/scripts/shared.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const flags = {}
for (const [i, arg] of process.argv.slice(2).entries()) {
  const value = process.argv[i + 3]
  if (arg === "--mocks" || arg === "--fresh") flags[arg.slice(2)] = true
  else if ((arg === "--port" || arg === "--core-port" || arg === "--workspace") && value) flags[arg.slice(2)] = value
}

const vitePort = Number(flags.port) || (await freePort())
const viteUrl = `http://localhost:${vitePort}/`

let core = null
let server = null
if (!flags.mocks) {
  const corePort = Number(flags["core-port"]) || (await freePort())
  // Named for the checkout, so a worktree's preview keeps its own data beside the main checkout's
  const home = path.join(os.tmpdir(), "owlit-dev-web", checkoutLabel(root) || "dev")
  if (flags.fresh) rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true })

  // esbuild lives in the desktop package; the bundle is made again at every start (a few seconds)
  const esbuild = createRequire(path.join(desktopDir, "package.json"))("esbuild")
  const bundle = path.join(home, "bundle")
  await esbuild.build({
    ...esbuildOptions({ production: false, channel: "dev" }),
    entryPoints: { core: path.join(root, "packages/core/src/index.ts"), "owlit-mcp": path.join(root, "packages/owlit-mcp/src/main.ts"), "owlit-agent": path.join(root, "packages/owlit-agent/src/main.ts"), owlit: path.join(root, "packages/cli/src/main.ts") },
    outdir: bundle,
    sourcemap: false,
  })
  const { Core } = createRequire(import.meta.url)(path.join(bundle, "core.cjs"))

  const workspace = flags.workspace ? realpathSync(path.resolve(flags.workspace)) : path.join(home, "workspace")
  refuseReal(workspace)
  if (!existsSync(workspace)) cpSync(path.join(desktopDir, "resources/example-workspace"), workspace, { recursive: true })

  const fromCore = createRequire(path.join(root, "packages/core/package.json"))
  core = new Core({
    userDataDir: path.join(home, "data"),
    appVersion: JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8")).version,
    debug: true,
    // owlit-mcp and the CLI reach this workspace as they reach any other
    socket: true,
    // The extension server would take Owlit Dev's port; a browser tab has no window to pair with anyway
    extension: false,
    mcp: { command: process.execPath, args: [path.join(bundle, "owlit-mcp.cjs")] },
    engine: { command: process.execPath, args: [path.join(bundle, "owlit-agent.cjs")] },
    pdfiumWasm: fromCore.resolve("@embedpdf/pdfium/pdfium.wasm"),
    exampleDir: path.join(desktopDir, "resources/example-workspace"),
    changelog: path.join(desktopDir, "CHANGELOG.md"),
    host: {
      // No browser of the user's to open: say where it would have gone
      openExternal: async (url) => console.log("[dev-web] would open", url),
      openInBrowser: async (url) => console.log("[dev-web] would open", url),
    },
  })
  core.start()
  const info = await core.openWorkspace(workspace)
  await addFakeEngine(core)

  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    if (!url.pathname.startsWith("/workspace/")) {
      res.writeHead(404).end()
      return
    }
    const headers = req.headers.range ? { range: req.headers.range } : undefined
    const response = await core.serveFile(new Request(`owlit-file://workspace${url.pathname.slice("/workspace".length)}`, { headers }))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (response.body) Readable.fromWeb(response.body).pipe(res)
    else res.end()
  })
  const sockets = new WebSocketServer({ server })
  sockets.on("connection", (socket) => {
    const unsubscribe = core.onNotify((notification) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(notification))
    })
    socket.on("message", async (data) => {
      const request = JSON.parse(String(data))
      const response = await core.handle(request)
      if ("error" in response) console.log(`[dev-web] ${request.method}: ${response.error.message}`)
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(response))
    })
    socket.on("close", unsubscribe)
  })
  await new Promise((resolve) => server.listen(corePort, "127.0.0.1", resolve))
  process.env.VITE_OWLIT_CORE = `ws://127.0.0.1:${corePort}`
  console.log(`[dev-web] core on ${process.env.VITE_OWLIT_CORE}, data in ${home}`)
  console.log(`[dev-web] workspace ${info.path}`)
  console.log(`[dev-web] from a shell: node ${path.join(bundle, "owlit.cjs")} --workspace ${info.path} <command>`)
}

// Vite runs as a direct child (not through pnpm exec) so stopping this script stops it too
const vite = spawn(process.execPath, [path.join(appDir, "node_modules/vite/bin/vite.js"), "--port", String(vitePort), "--strictPort"], {
  cwd: appDir,
  stdio: ["ignore", "inherit", "inherit"],
  env: process.env,
})
vite.on("exit", (code) => shutdown(code ?? 1))

let stopping = false
async function shutdown(code) {
  if (stopping) return
  stopping = true
  if (vite.exitCode === null) vite.kill()
  server?.close()
  await core?.dispose().catch(() => undefined)
  process.exit(code)
}
process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

// The fake engine as an agent, added once; its header says which prompts make it ask, edit or crash
async function addFakeEngine(core) {
  const fake = path.join(root, "packages/core/src/agents/fake-acp.ts")
  const call = async (method, params) => {
    const response = await core.handle({ jsonrpc: "2.0", id: 0, method, params })
    if ("error" in response) throw new Error(response.error.message)
    return response.result
  }
  const agents = await call("agents.list")
  if (agents.some((a) => a.command?.includes(fake))) return
  await call("agents.add", { name: "Fake engine", command: `"${process.execPath}" "${fake}"` })
}

// A real workspace of yours is never opened here: the real app data's settings say which folders those are
function refuseReal(workspace) {
  let settings
  try {
    settings = JSON.parse(readFileSync(path.join(realData, "settings.json"), "utf8"))
  } catch {
    return
  }
  const real = [settings.lastWorkspace, ...(settings.recentWorkspaces ?? [])].filter((w) => typeof w === "string" && existsSync(w)).map((w) => realpathSync(w))
  if (real.some((w) => workspace === w || workspace.startsWith(w + path.sep))) throw new Error(`${workspace} is one of your real workspaces; pnpm dev:web opens a copy of the example workspace, or --workspace a copy`)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.on("error", reject)
    probe.listen(0, () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}
