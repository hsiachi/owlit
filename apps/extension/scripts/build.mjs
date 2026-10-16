// pnpm --filter @owlit/extension build: dist/ ready for "Load unpacked", and release/owlit-extension-<version>.zip
// for the Chrome Web Store. --watch rebuilds on change (and makes no zip).
//
// Three parts: the popup and the background service worker (vite.config.ts), the content script as one
// classic script (a content script can't import), and manifest.json, whose publisher sites come from
// core's publisher table (hosts.mjs).
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { build } from "vite"
import { publisherHosts } from "./hosts.mjs"

const root = path.resolve(import.meta.dirname, "..")
const watch = process.argv.includes("--watch")
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const dist = path.join(root, "dist")

const ICONS = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" }

function manifest(publishers) {
  return {
    manifest_version: 3,
    name: "owlit",
    version,
    description: "Add the paper of the page you're on to owlit, with its PDF, using your browser's access.",
    icons: ICONS,
    action: { default_title: "owlit", default_popup: "popup.html", default_icon: ICONS },
    background: { service_worker: "background.js", type: "module" },
    content_scripts: [{ matches: publishers, js: ["content.js"], run_at: "document_idle" }],
    permissions: ["storage", "activeTab", "scripting", "notifications", "webRequest", "alarms"],
    // owlit on this machine (any port: Firefox takes no port in a pattern), and the publishers owlit knows
    host_permissions: ["http://127.0.0.1/*", ...publishers],
    // Any other site, asked for one at a time from a click in the popup
    optional_host_permissions: ["https://*/*"],
    // Module service workers, and webRequest's responseHeaders without extraHeaders
    minimum_chrome_version: "116",
  }
}

const publishers = await publisherHosts()
await build({ root, configFile: path.join(root, "vite.config.ts"), build: { watch: watch ? {} : null } })
await build({
  root,
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: dist,
    emptyOutDir: false,
    target: "chrome116",
    watch: watch ? {} : null,
    lib: { entry: path.join(root, "src/content/index.ts"), formats: ["iife"], name: "owlitContent", fileName: () => "content.js" },
  },
})
writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest(publishers), null, 2) + "\n")

if (!watch) {
  const release = path.join(root, "release")
  mkdirSync(release, { recursive: true })
  const zip = path.join(release, `owlit-extension-${version}.zip`)
  rmSync(zip, { force: true })
  // -X: no macOS extra attributes, which the store's checker reads as stray files
  execFileSync("zip", ["-r", "-X", "-q", zip, "."], { cwd: dist })
  console.log(`dist/ is ready to load unpacked; ${path.relative(root, zip)} is for the Chrome Web Store`)
}
