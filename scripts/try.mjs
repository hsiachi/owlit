// pnpm try: open this checkout as Owlit Dev, on a clone of your data (apps/desktop/scripts/preview.mjs),
// after getting a fresh worktree ready: packages installed when the lockfile has changed, and Electron's
// binary cloned from the main checkout instead of downloaded. Flags go on to pnpm dev (--fresh clones the
// data again). Node built-ins only, since it runs before anything is installed.

import { execFileSync, spawn } from "node:child_process"
import { existsSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null)

// pnpm keeps a copy of the lockfile it last installed from
if (read(path.join(root, "pnpm-lock.yaml")) !== read(path.join(root, "node_modules/.pnpm/lock.yaml"))) {
  console.log("[try] installing packages")
  execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: root, stdio: "inherit", env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: "1" } })
}

const electron = path.join(root, "apps/desktop/node_modules/electron")
if (!existsSync(path.join(electron, "path.txt"))) {
  const version = JSON.parse(readFileSync(path.join(electron, "package.json"), "utf8")).version
  const common = execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()
  const main = path.join(path.dirname(common), "apps/desktop/node_modules/electron")
  const mainVersion = existsSync(path.join(main, "path.txt")) ? JSON.parse(readFileSync(path.join(main, "package.json"), "utf8")).version : null
  if (mainVersion === version) {
    console.log("[try] cloning Electron from the main checkout")
    rmSync(path.join(electron, "dist"), { recursive: true, force: true })
    execFileSync("cp", ["-cR", path.join(main, "dist"), path.join(electron, "dist")])
    execFileSync("cp", [path.join(main, "path.txt"), path.join(electron, "path.txt")])
  } else {
    console.log(`[try] downloading Electron ${version}`)
    // Node's fetch ignores HTTPS_PROXY unless told to
    execFileSync(process.execPath, ["install.js"], { cwd: electron, stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } })
  }
}

const args = process.argv.slice(2).filter((arg) => arg !== "--")
const dev = spawn(process.execPath, [path.join(root, "apps/desktop/scripts/dev.mjs"), ...args], { stdio: "inherit" })
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => dev.kill(signal))
dev.on("exit", (code) => process.exit(code ?? 0))
