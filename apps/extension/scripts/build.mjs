// pnpm --filter @owlit/extension build: dist/chrome/ and dist/firefox/, each ready to load unpacked, and
// release/owlit-extension-<version>-<browser>.zip for the Chrome Web Store and addons.mozilla.org.
// --watch rebuilds on change (and makes no zip); --target chrome|firefox builds that one alone.
//
// Per browser, three parts: the popup and the background (vite.config.ts), the content script as one
// classic script (a content script can't import), and manifest.json (src/manifest.ts), whose publisher
// sites come from core's publisher table (hosts.mjs).
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { build, runnerImport } from "vite"
import { publisherHosts } from "./hosts.mjs"

// Before any runnerImport: Vite's module runner sets an unset NODE_ENV to development, and the builds
// below would then bundle React's development build into the popup
process.env.NODE_ENV ??= "production"

const root = path.resolve(import.meta.dirname, "..")
const watch = process.argv.includes("--watch")
const only = process.argv.includes("--target") ? process.argv[process.argv.indexOf("--target") + 1] : undefined
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const { module: manifests } = await runnerImport(path.join(root, "src/manifest.ts"), { configFile: false, logLevel: "silent" })
const targets = only ? [only] : manifests.TARGETS
for (const target of targets) if (!manifests.TARGETS.includes(target)) throw new Error(`No such browser to build for: ${target}`)

// The syntax each browser's oldest supported version reads
const ES_TARGET = { chrome: `chrome${manifests.CHROME_MIN}`, firefox: `firefox${parseInt(manifests.FIREFOX_MIN)}` }

const publishers = await publisherHosts()
const release = path.join(root, "release")
// A build before the per-browser folders left its files at dist/'s top
if (!only) rmSync(path.join(root, "dist"), { recursive: true, force: true })

for (const target of targets) {
  const dist = path.join(root, "dist", target)
  await build({ root, configFile: path.join(root, "vite.config.ts"), logLevel: "warn", build: { outDir: dist, target: ES_TARGET[target], watch: watch ? {} : null } })
  await build({
    root,
    configFile: false,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir: dist,
      emptyOutDir: false,
      target: ES_TARGET[target],
      watch: watch ? {} : null,
      lib: { entry: path.join(root, "src/content/index.ts"), formats: ["iife"], name: "owlitContent", fileName: () => "content.js" },
    },
  })
  writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifests.manifest(target, { version, publishers }), null, 2) + "\n")
  if (watch) continue
  mkdirSync(release, { recursive: true })
  const zip = path.join(release, `owlit-extension-${version}-${target}.zip`)
  rmSync(zip, { force: true })
  // -X: no macOS extra attributes, which the stores' checkers read as stray files
  execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: dist })
}

if (!watch) {
  const store = { chrome: "the Chrome Web Store", firefox: "addons.mozilla.org" }
  for (const target of targets) console.log(`dist/${target}/ is ready to load unpacked; release/owlit-extension-${version}-${target}.zip is for ${store[target]}`)
}
