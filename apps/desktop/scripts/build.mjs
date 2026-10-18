// pnpm build: the renderer (app/, through its own tsc + vite build), main and preload, then Owlit.app in
// apps/desktop/release/. pnpm release adds the arm64 dmg that is sent to people (T31).
//
// Signing: OWLIT_SIGN_IDENTITY names the code-signing certificate to sign with (the self-signed "Owlit
// Self-Signed" in the login keychain, so macOS sees every version as the same app and keeps its Keychain
// and folder grants); without it the app is signed ad hoc, which runs but is a new app to macOS each
// build. electron-builder won't sign with a certificate macOS doesn't trust, and a self-signed one isn't
// (CSSMERR_TP_NOT_TRUSTED; trusting it would change the system's trust settings), so the app is signed
// here after packing, with Electron's own signer told not to check trust. Nothing is notarised: there is
// no Apple Developer account, so Gatekeeper stops the first open of each dmg.

import { execFileSync } from "node:child_process"
import { cpSync, readFileSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import * as esbuild from "esbuild"
import { Arch, build, Platform } from "electron-builder"
import { appDir, copyMainAssets, desktopDir, distDir, esbuildOptions } from "./shared.mjs"

const require = createRequire(import.meta.url)
const release = process.argv.includes("--release")

// A release reads the maintainer's own settings from .env.release.local at the repo root (ignored by git):
// the share server its links are made on, and the signing identity. The environment wins over the file, so
// CI can set them instead. A release must name a share server, or set it empty for none, so a dmg is never
// sent out without sharing by mistake.
if (release) {
  try {
    process.loadEnvFile(path.join(desktopDir, "../../.env.release.local"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (process.env.OWLIT_SHARE_SERVER === undefined) {
    console.error("A release needs OWLIT_SHARE_SERVER (in .env.release.local or the environment), or OWLIT_SHARE_SERVER= for none.")
    process.exit(1)
  }
}

rmSync(distDir, { recursive: true, force: true })

execFileSync("pnpm", ["run", "build"], { cwd: appDir, stdio: "inherit" })
cpSync(path.join(appDir, "dist"), path.join(distDir, "renderer"), { recursive: true })

await esbuild.build(esbuildOptions({ production: true, channel: release ? "release" : "local" }))
copyMainAssets()

const identity = process.env.OWLIT_SIGN_IDENTITY
const entitlements = path.join(desktopDir, "resources", "entitlements.mac.plist")

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
    // npm runs scripts of its own, which can't run from inside the asar archive; the example workspace is
    // copied with fs.cp, which Electron's asar support doesn't cover
    asarUnpack: ["dist/npm/**", "dist/example-workspace/**"],
    npmRebuild: false,
    // icon.icns comes from scripts/icon.mjs, with a heavier line at the small sizes
    // Signed with the certificate before the dmg is made (see above)
    afterPack: identity
      ? async ({ appOutDir }) => {
          const { signAsync } = await import("@electron/osx-sign")
          await signAsync({
            app: path.join(appOutDir, "Owlit.app"),
            identity,
            identityValidation: false,
            platform: "darwin",
            // No timestamp: Apple's timestamp server adds nothing to a self-signed signature, and a call per file
            optionsForFile: () => ({ hardenedRuntime: true, entitlements, timestamp: "none" }),
          })
        }
      : undefined,
    mac: {
      // null: electron-builder leaves signing to afterPack
      identity: identity ? null : "-",
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
