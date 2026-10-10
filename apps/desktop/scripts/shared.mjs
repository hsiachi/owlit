import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
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
    entryPoints: { main: "src/main.ts", preload: "src/preload.ts", "owlit-mcp": "../../packages/owlit-mcp/src/main.ts", "owlit-agent": "../../packages/owlit-agent/src/main.ts" },
    outdir: distDir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: production ? false : "linked",
    define: { "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"), "import.meta.url": "__importMetaUrl" },
    // ES modules bundled into CommonJS (pdfium's loader) ask where they are through import.meta.url
    // (no require here: the sandboxed preload shares the banner and may not require node modules)
    banner: { js: 'const __importMetaUrl = typeof __filename === "string" ? "file://" + encodeURI(__filename) : "";' },
    logLevel: "warning",
    // core finds pdfium's wasm through import.meta.resolve when it isn't told where it is; main tells it
    logOverride: { "empty-import-meta": "silent" },
  }
}

// Files main needs beside it at run time: pdfium's wasm (core reads PDFs with it)
export function copyMainAssets() {
  const fromCore = createRequire(path.join(desktopDir, "../../packages/core/package.json"))
  mkdirSync(distDir, { recursive: true })
  copyFileSync(fromCore.resolve("@embedpdf/pdfium/pdfium.wasm"), path.join(distDir, "pdfium.wasm"))
}
