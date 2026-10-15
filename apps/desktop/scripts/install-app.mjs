// pnpm app:install: build this checkout and put it in /Applications as the Owlit you use day to day, on
// your real data. It changes only when you run this, so merging into dev never restarts it; pnpm dev and
// pnpm try are Owlit Dev, on a clone of that data (scripts/preview.mjs).
//
// Signed and with the share server as a release is (.env.release.local), so macOS keeps its Keychain and
// folder grants from one install to the next and links can be shared. An open Owlit is asked to quit
// first, as ⌘Q would, and is opened again at the end.

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, renameSync, rmSync } from "node:fs"
import path from "node:path"
import { desktopDir } from "./shared.mjs"

const root = path.resolve(desktopDir, "../..")
// --to=<path> installs somewhere else, to try this script without touching /Applications
const target = process.argv.find((arg) => arg.startsWith("--to="))?.slice(5) ?? "/Applications/Owlit.app"
const built = path.join(desktopDir, "release/mac-arm64/Owlit.app")

try {
  process.loadEnvFile(path.join(root, ".env.release.local"))
} catch (error) {
  if (error.code !== "ENOENT") throw error
}

const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim()
const branch = git("rev-parse", "--abbrev-ref", "HEAD")
const commit = git("rev-parse", "--short", "HEAD")
const dirty = git("status", "--porcelain") !== ""
if (branch !== "dev") console.log(`\n! This is ${branch}, not dev: the Owlit you use will be this branch until the next install.`)
if (dirty) console.log("\n! There are uncommitted changes; they go into the build.")
if (!process.env.OWLIT_SIGN_IDENTITY) console.log("\n! No OWLIT_SIGN_IDENTITY: signed ad hoc, so macOS may ask again for Keychain and folder access.")

console.log(`\n→ Building Owlit from ${branch} at ${commit}${dirty ? " (with changes)" : ""}`)
execFileSync(process.execPath, [path.join(desktopDir, "scripts/build.mjs")], { cwd: desktopDir, stdio: "inherit" })

const running = () => spawnSync("pgrep", ["-f", `^${target}/Contents/MacOS/Owlit`]).status === 0
if (running()) {
  console.log("\n→ Quitting Owlit")
  spawnSync("osascript", ["-e", `tell application "${target}" to quit`], { stdio: "ignore" })
  const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  const waitUntil = (until) => {
    while (running() && Date.now() < until) sleep(500)
  }
  waitUntil(Date.now() + 15_000)
  // macOS may not let this Terminal send Apple events; Electron quits the same way on SIGTERM
  if (running()) spawnSync("pkill", ["-TERM", "-f", `^${target}/Contents/MacOS/Owlit`])
  waitUntil(Date.now() + 45_000)
  if (running()) {
    console.error(`\n✗ Owlit is still open. Quit it, then run pnpm app:install again (the build is in ${built}).`)
    process.exit(1)
  }
}

console.log(`\n→ Installing in ${target}`)
const old = path.join(path.dirname(target), `.Owlit-replaced-${Date.now()}.app`)
if (existsSync(target)) renameSync(target, old)
try {
  // ditto keeps the signature's extended attributes and symlinks as they are
  execFileSync("ditto", [built, target])
} catch (error) {
  rmSync(target, { recursive: true, force: true })
  if (existsSync(old)) renameSync(old, target)
  throw error
}
rmSync(old, { recursive: true, force: true })

const open = !process.argv.includes("--no-open")
if (open) execFileSync("open", [target])
console.log(`\n✓ Owlit from ${branch} at ${commit} is in ${target}${open ? ", open" : ""}.`)
