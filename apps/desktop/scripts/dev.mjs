// pnpm dev: Vite's dev server for the renderer (HMR), esbuild watching main and preload, and Electron
// restarted whenever either of those rebuilds. Closing the app ends the whole thing.
//
// It runs as Owlit Dev on a clone of your data (scripts/preview.mjs), so it can stay open beside the Owlit
// you use. --fresh clones the data again; OWLIT_USER_DATA picks another folder and clones nothing.

import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import net from "node:net"
import path from "node:path"
import * as esbuild from "esbuild"
import { checkoutLabel, devBundle, previewData } from "./preview.mjs"
import { appDir, copyMainAssets, desktopDir, esbuildOptions } from "./shared.mjs"

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
const args = process.argv.slice(2).filter((arg) => arg !== "--")
const electronArgs = args.filter((arg) => arg !== "--fresh")

const checkout = path.resolve(desktopDir, "../..")
const label = checkoutLabel(checkout)
const name = label ? `Owlit Dev (${label})` : "Owlit Dev"
const devBin = devBundle({
  electronBin,
  cacheDir: path.join(desktopDir, "node_modules/.cache/owlit-dev"),
  name,
  icon: path.join(desktopDir, "resources/icon-dev.icns"),
})
const userData = process.env.OWLIT_USER_DATA || previewData({ checkout, fresh: args.includes("--fresh") })

let electron = null
let restarting = false

function startElectron() {
  electron = spawn(devBin, [desktopDir, ...electronArgs], {
    stdio: "inherit",
    env: { ...process.env, OWLIT_DEV_URL: devUrl, OWLIT_DEV_NAME: name, OWLIT_USER_DATA: userData },
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

copyMainAssets()
const options = esbuildOptions({ production: false })
const ctx = await esbuild.context({
  ...options,
  plugins: [
    ...options.plugins,
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
