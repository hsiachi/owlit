// pnpm build: the renderer (app/, through its own tsc + vite build), main and preload, then Owlit.app in
// apps/desktop/release/. pnpm release adds the arm64 dmg that is sent to people (T31).
//
// Signing: OWLIT_SIGN_IDENTITY names the code-signing certificate to sign with (the self-signed one kept
// in the login keychain, so macOS sees every version as the same app and keeps its Keychain and folder
// grants); without it the app is signed ad hoc, which runs but is a new app to macOS each build. Nothing
// is notarised: there is no Apple Developer account, so Gatekeeper stops the first open of each dmg.

import { execFileSync } from "node:child_process"
import { cpSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import * as esbuild from "esbuild"
import { Arch, build, Platform } from "electron-builder"
import { appDir, copyMainAssets, desktopDir, distDir, esbuildOptions } from "./shared.mjs"

const require = createRequire(import.meta.url)

rmSync(distDir, { recursive: true, force: true })

execFileSync("pnpm", ["run", "build"], { cwd: appDir, stdio: "inherit" })
cpSync(path.join(appDir, "dist"), path.join(distDir, "renderer"), { recursive: true })

await esbuild.build(esbuildOptions({ production: true }))
copyMainAssets()

const release = process.argv.includes("--release")
const identity = process.env.OWLIT_SIGN_IDENTITY || "-"

await build({
  projectDir: desktopDir,
  targets: Platform.MAC.createTarget(release ? ["dmg"] : ["dir"], Arch.arm64),
  // Nothing is uploaded anywhere: the dmg is sent by hand
  publish: "never",
  config: {
    publish: null,
    appId: "app.owlit.desktop",
    productName: "Owlit",
    electronVersion: require("electron/package.json").version,
    directories: { output: "release" },
    files: ["dist/**/*", "package.json"],
    // npm runs scripts of its own, which can't run from inside the asar archive
    asarUnpack: ["dist/npm/**"],
    npmRebuild: false,
    // icon.icns comes from scripts/icon.mjs, with a heavier line at the small sizes
    mac: {
      identity,
      category: "public.app-category.productivity",
      icon: "resources/icon.icns",
      // Electron's own entitlements (JIT for V8 and pdfium's wasm); the same ones serve a real Developer ID later
      hardenedRuntime: true,
      entitlements: "resources/entitlements.mac.plist",
      entitlementsInherit: "resources/entitlements.mac.plist",
      notarize: false,
    },
    dmg: {
      title: "Owlit ${version}",
      artifactName: "Owlit ${version}.dmg",
      // The block map is for auto-update, which owlit doesn't do
      writeUpdateInfo: false,
      // The window: the app, an arrow, Applications, and how to open it the first time (resources/dmg/background.svg)
      background: "resources/dmg/background.png",
      window: { width: 540, height: 380 },
      iconSize: 112,
      contents: [
        { x: 140, y: 170, type: "file" },
        { x: 400, y: 170, type: "link", path: "/Applications" },
      ],
    },
  },
})

if (release) {
  const { version } = JSON.parse(readFileSync(path.join(desktopDir, "package.json"), "utf8"))
  const { writeRelease } = await import("./release-notes.mjs")
  writeRelease(version)
}
