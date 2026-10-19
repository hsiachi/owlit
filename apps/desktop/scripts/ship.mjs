// pnpm release:ship <version>: the whole release, from the checkout of dev on the maintainer's Mac.
//
// It stops before anything leaves this Mac if a step fails: dev must be clean and level with origin,
// CHANGELOG.md must have the version's section, and the checks and the signed build must pass. Only then
// does main move up to dev (a fast-forward, so main is always a released dev), the tag and both branches go
// to GitHub, and the GitHub release is made with the read-me as its notes. Pushing main also deploys the
// share server (.github/workflows/share-worker.yml), so readers' pages match the app that was just sent.
//
// OWLIT_RELEASE_ARCHIVE in .env.release.local, if set, is a folder each release's dmg and read-me are
// copied into (<folder>/<version>/).

import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { desktopDir } from "./shared.mjs"

const root = path.resolve(desktopDir, "../..")
const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail("Usage: pnpm release:ship <version>, e.g. pnpm release:ship 0.1.1")
const tag = `v${version}`

try {
  process.loadEnvFile(path.join(root, ".env.release.local"))
} catch (error) {
  if (error.code !== "ENOENT") throw error
}

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

function step(message) {
  console.log(`\n→ ${message}`)
}

// Output captured, for reading git's answers
function read(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim()
}

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: "inherit" })
}

step("Checking dev")
if (read("git", ["branch", "--show-current"]) !== "dev") fail("Run it from the checkout of dev.")
if (read("git", ["status", "--porcelain"])) fail("dev has uncommitted changes.")
run("git", ["fetch", "--quiet", "--tags", "origin"])
if (read("git", ["rev-list", "--count", "dev..origin/dev"]) !== "0") fail("origin/dev has commits this dev doesn't; merge them first.")
if (read("git", ["tag", "--list", tag])) fail(`${tag} already exists.`)
// main only ever moves to a released dev, so it must already be in dev's history
try {
  read("git", ["merge-base", "--is-ancestor", "origin/main", "dev"])
} catch {
  fail("origin/main isn't in dev's history, so main can't simply move up to dev.")
}
const changelog = readFileSync(path.join(desktopDir, "CHANGELOG.md"), "utf8")
if (!changelog.includes(`\n## ${version}\n`)) fail(`apps/desktop/CHANGELOG.md has no "## ${version}" section.`)
if (process.env.OWLIT_SHARE_SERVER === undefined) fail("OWLIT_SHARE_SERVER isn't set (.env.release.local).")
if (!process.env.OWLIT_SIGN_IDENTITY) fail("OWLIT_SIGN_IDENTITY isn't set (.env.release.local), so the dmg would be signed ad hoc.")

const pkgFile = path.join(desktopDir, "package.json")
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
if (pkg.version !== version) {
  step(`Version ${pkg.version} → ${version}`)
  writeFileSync(pkgFile, readFileSync(pkgFile, "utf8").replace(`"version": "${pkg.version}"`, `"version": "${version}"`))
  run("git", ["commit", "--quiet", "-m", `Owlit ${version}`, "--", pkgFile])
}

step("Typecheck, lint and test")
// What the lockfile says, not whatever node_modules holds (a pnpm link, a package edited while debugging)
run("pnpm", ["install", "--frozen-lockfile"])
run("pnpm", ["check"])

step("Building and signing the dmg")
run("pnpm", ["release"])
const dmg = path.join(desktopDir, "release", `Owlit ${version}.dmg`)
const notes = path.join(desktopDir, "release", `Owlit ${version} - read me first.txt`)

step(`main → dev, ${tag}, pushed`)
run("git", ["branch", "--force", "main", "dev"])
run("git", ["tag", "--annotate", tag, "--message", `Owlit ${version}`, "dev"])
run("git", ["push", "--atomic", "origin", "dev", "main", tag])

step("GitHub release")
run("gh", ["release", "create", tag, dmg, "--title", `Owlit ${version}`, "--notes-file", notes])

if (process.env.OWLIT_RELEASE_ARCHIVE) {
  const folder = path.join(process.env.OWLIT_RELEASE_ARCHIVE, version)
  mkdirSync(folder, { recursive: true })
  cpSync(dmg, path.join(folder, path.basename(dmg)))
  cpSync(notes, path.join(folder, path.basename(notes)))
  console.log(`  • copied to ${folder}`)
}

console.log(`\n✓ Owlit ${version} is out: ${read("gh", ["release", "view", tag, "--json", "url", "--jq", ".url"])}`)
