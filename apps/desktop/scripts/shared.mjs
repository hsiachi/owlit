import path from "node:path"
import { fileURLToPath } from "node:url"

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const appDir = path.resolve(desktopDir, "../../app")
export const distDir = path.join(desktopDir, "dist")

// Main and preload are bundled together with core, so a packaged app needs no node_modules. Preload is
// CommonJS because a sandboxed preload cannot be an ES module.
export function esbuildOptions({ production }) {
  return {
    absWorkingDir: desktopDir,
    entryPoints: { main: "src/main.ts", preload: "src/preload.ts" },
    outdir: distDir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: production ? false : "linked",
    define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development") },
    logLevel: "warning",
  }
}
