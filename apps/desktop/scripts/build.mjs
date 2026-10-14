// pnpm build: the renderer (app/, through its own tsc + vite build), main and preload, then an unsigned
// owlit.app in apps/desktop/release/. Signing and notarisation come later (T31).

import { execFileSync } from "node:child_process"
import { cpSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import * as esbuild from "esbuild"
import { build, Platform } from "electron-builder"
import { appDir, copyMainAssets, desktopDir, distDir, esbuildOptions } from "./shared.mjs"

const require = createRequire(import.meta.url)

rmSync(distDir, { recursive: true, force: true })

execFileSync("pnpm", ["run", "build"], { cwd: appDir, stdio: "inherit" })
cpSync(path.join(appDir, "dist"), path.join(distDir, "renderer"), { recursive: true })

await esbuild.build(esbuildOptions({ production: true }))
copyMainAssets()

await build({
  projectDir: desktopDir,
  targets: Platform.MAC.createTarget("dir"),
  config: {
    appId: "app.owlit.desktop",
    productName: "Owlit",
    electronVersion: require("electron/package.json").version,
    directories: { output: "release" },
    files: ["dist/**/*", "package.json"],
    asarUnpack: ["dist/npm/**"],
    npmRebuild: false,
    // icon.icns comes from scripts/icon.mjs, with a heavier line at the small sizes
    mac: { identity: null, category: "public.app-category.productivity", icon: "resources/icon.icns" },
  },
})
