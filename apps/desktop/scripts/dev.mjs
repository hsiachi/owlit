// pnpm dev: Vite's dev server for the renderer (HMR), esbuild watching main and preload, and Electron
// restarted whenever either of those rebuilds. Closing the app ends the whole thing.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import net from "node:net"
import path from "node:path"
import * as esbuild from "esbuild"
import { appDir, desktopDir, esbuildOptions } from "./shared.mjs"

const require = createRequire(import.meta.url)
const electronBin = require("electron")

const port = Number(process.env.OWLIT_DEV_PORT) || (await freePort())
const devUrl = `http://localhost:${port}/`

// Vite runs as a direct child (not through pnpm exec) so stopping this script stops it too
const viteBin = path.join(appDir, "node_modules/vite/bin/vite.js")
const vite = spawn(process.execPath, [viteBin, "--port", String(port), "--strictPort"], {
  cwd: appDir,
  stdio: ["ignore", "inherit", "inherit"],
})
vite.on("exit", (code) => shutdown(code ?? 1))
await waitForServer(devUrl)

// Extra flags go to Electron, e.g. pnpm dev -- --remote-debugging-port=9333
const electronArgs = process.argv.slice(2).filter((arg) => arg !== "--")

let electron = null
let restarting = false

function startElectron() {
  electron = spawn(electronBin, [desktopDir, ...electronArgs], {
    stdio: "inherit",
    env: { ...process.env, OWLIT_DEV_URL: devUrl },
  })
  electron.on("exit", (code) => {
    if (restarting) return
    shutdown(code ?? 0)
  })
}

async function restartElectron() {
  if (electron && electron.exitCode === null) {
    restarting = true
    const exited = new Promise((resolve) => electron.once("exit", resolve))
    electron.kill()
    await exited
    restarting = false
  }
  startElectron()
}

const ctx = await esbuild.context({
  ...esbuildOptions({ production: false }),
  plugins: [
    {
      name: "restart-electron",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) void restartElectron()
        })
      },
    },
  ],
})
await ctx.watch()

let stopping = false
function shutdown(code) {
  if (stopping) return
  stopping = true
  void ctx?.dispose()
  if (electron && electron.exitCode === null) electron.kill()
  if (vite.exitCode === null) vite.kill()
  process.exit(code)
}
process.on("SIGINT", () => shutdown(0))
process.on("SIGTERM", () => shutdown(0))

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on("error", reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForServer(url) {
  for (let i = 0; i < 300; i++) {
    try {
      await fetch(url)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error(`Vite did not start at ${url}`)
}
