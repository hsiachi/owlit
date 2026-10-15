// What pnpm dev runs as: Owlit Dev, a preview of this checkout beside the Owlit you use, never in its place.
// Node built-ins only.
//
// - devBundle: a copy of Electron.app named for the checkout ("Owlit Dev", or "Owlit Dev (show-in-paper)"
//   in a worktree) with the graphite icon, so the Dock, ⌘Tab and the menu bar say which preview it is.
//   The app's own name stays "Owlit": it names the keychain item settings' keys are sealed with, which a
//   clone of the real data has to open.
// - previewData: the preview's own app data, a clone of the real data taken the first time, with its
//   workspaces cloned too. Owlit never sees the real folders, so a preview can't touch them, and APFS clones
//   cost no disk space until either side changes.

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const support = path.join(os.homedir(), "Library", "Application Support")
// The installed Owlit's data (app.name "Owlit"; the folder was made lowercase by earlier dev runs, and macOS
// paths ignore case)
const realData = process.env.OWLIT_PREVIEW_SOURCE ?? path.join(support, "owlit")
const previewsDir = path.join(support, "Owlit Previews")

// What this checkout is called: nothing for the main checkout on dev, else the branch's last part
export function checkoutLabel(checkout) {
  let branch = ""
  try {
    branch = execFileSync("git", ["-C", checkout, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim()
  } catch {}
  if (!branch || branch === "HEAD") branch = path.basename(checkout)
  return branch === "dev" ? "" : branch.split("/").pop()
}

export function devBundle({ electronBin, cacheDir, name, icon }) {
  const source = path.resolve(electronBin, "../../..")
  const bundle = path.join(cacheDir, "Owlit Dev.app")
  const stamp = path.join(cacheDir, "stamp.json")
  const want = JSON.stringify({ name, electron: plistValue(path.join(source, "Contents/Info.plist"), "CFBundleVersion"), icon: hashFile(icon) })
  if (existsSync(bundle) && existsSync(stamp) && readFileSync(stamp, "utf8") === want) return path.join(bundle, "Contents/MacOS/Electron")

  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(cacheDir, { recursive: true })
  execFileSync("cp", ["-cR", source, bundle])
  const plist = path.join(bundle, "Contents/Info.plist")
  for (const [key, value] of [["CFBundleName", name], ["CFBundleDisplayName", name], ["CFBundleIdentifier", "app.owlit.dev"]])
    execFileSync("plutil", ["-replace", key, "-string", value, plist])
  execFileSync("cp", [icon, path.join(bundle, "Contents/Resources/electron.icns")])
  // Editing Info.plist breaks the bundle's seal; macOS ties keychain and folder grants to the signature
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" })
  writeFileSync(stamp, want)
  return path.join(bundle, "Contents/MacOS/Electron")
}

// The preview's app data folder for this checkout, cloned from the real one when it doesn't exist yet (or
// when fresh). Previews of checkouts that are gone are removed on the way.
export function previewData({ checkout, fresh }) {
  pruneGone()
  const slug = `${path.basename(checkout)}-${createHash("sha1").update(checkout).digest("hex").slice(0, 6)}`
  const dir = path.join(previewsDir, slug)
  const data = path.join(dir, "data")
  if (existsSync(path.join(dir, "preview.json")) && !fresh) return data

  rmSync(dir, { recursive: true, force: true })
  mkdirSync(data, { recursive: true })
  const cloned = existsSync(path.join(realData, "settings.json")) ? cloneReal(dir, data) : []
  writeFileSync(path.join(dir, "preview.json"), JSON.stringify({ checkout, at: new Date().toISOString(), workspaces: cloned }, null, 2))
  if (cloned.length) console.log(`[preview] cloned your data and ${cloned.map((w) => path.basename(w.clone)).join(", ")} into ${dir}`)
  return data
}

function cloneReal(dir, data) {
  for (const entry of readdirSync(realData)) {
    // Chromium's caches and lock, and the CLI script each launch writes again
    if (/Cache$|^Dawn|^GPU|^Singleton|^blob_storage$|^Crashpad$|^bin$|^workspaces$/.test(entry)) continue
    execFileSync("cp", ["-cR", path.join(realData, entry), path.join(data, entry)])
  }

  const settingsFile = path.join(data, "settings.json")
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"))
  const real = [...new Set([settings.lastWorkspace, ...(settings.recentWorkspaces ?? [])].filter((w) => typeof w === "string" && existsSync(w)))]
  const cloned = []
  for (const workspace of real) {
    let clone = path.join(dir, path.basename(workspace))
    for (let n = 2; cloned.some((c) => c.clone === clone); n++) clone = path.join(dir, `${path.basename(workspace)} ${n}`)
    execFileSync("cp", ["-cR", workspace, clone])
    cloneWorkspaceData(workspace, clone, data)
    cloned.push({ real: workspace, clone })
  }
  // Every path into a real workspace now points into its clone
  const move = (value) => {
    if (typeof value === "string") {
      const hit = cloned.find((c) => value === c.real || value.startsWith(c.real + path.sep))
      return hit ? hit.clone + value.slice(hit.real.length) : value
    }
    if (Array.isArray(value)) return value.map(move)
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, move(v)]))
    return value
  }
  writeFileSync(settingsFile, JSON.stringify(move(settings), null, 2))
  return cloned
}

// A workspace's app data lives under the hash of its path (core workspace.ts), so the clone's goes under
// the clone's. index.db is copied with SQLite's backup, which is whole even while the real Owlit writes to
// it; it is derived, so it is left for the preview to rebuild when that fails.
function cloneWorkspaceData(workspace, clone, data) {
  const from = path.join(realData, "workspaces", workspaceHash(workspace))
  const to = path.join(data, "workspaces", workspaceHash(clone))
  if (!existsSync(from)) return
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from)) {
    if (entry.startsWith("index.db")) continue
    execFileSync("cp", ["-cR", path.join(from, entry), path.join(to, entry)])
  }
  // The real Owlit's unfinished work stays its own: a preview that ran it again would open the same pages
  // in your browser and spend agent time twice (core tasks/store.ts reads open.json first)
  if (existsSync(path.join(to, "tasks"))) writeFileSync(path.join(to, "tasks", "open.json"), JSON.stringify({ version: 1, tasks: [] }))
  if (existsSync(path.join(from, "index.db"))) {
    try {
      execFileSync("sqlite3", [path.join(from, "index.db"), `.backup '${path.join(to, "index.db").replace(/'/g, "''")}'`], { stdio: "ignore" })
    } catch {
      rmSync(path.join(to, "index.db"), { force: true })
    }
  }
}

// core's socketHash
const workspaceHash = (workspace) => createHash("sha1").update(workspace.normalize("NFC")).digest("hex").slice(0, 12)

const plistValue = (plist, key) => execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], { encoding: "utf8" }).trim()

const hashFile = (file) => createHash("sha1").update(readFileSync(file)).digest("hex").slice(0, 12)

function pruneGone() {
  if (!existsSync(previewsDir)) return
  for (const slug of readdirSync(previewsDir)) {
    const dir = path.join(previewsDir, slug)
    if (slug.startsWith(".removing-")) {
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    try {
      const { checkout } = JSON.parse(readFileSync(path.join(dir, "preview.json"), "utf8"))
      if (checkout && !existsSync(checkout)) {
        // Move it out of the way first, so a half-removed preview never looks whole
        const doomed = path.join(previewsDir, `.removing-${slug}`)
        renameSync(dir, doomed)
        rmSync(doomed, { recursive: true, force: true })
      }
    } catch {}
  }
}
