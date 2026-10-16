import { execFileSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdirSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
export const appDir = path.resolve(desktopDir, "../../app")
export const distDir = path.join(desktopDir, "dist")

// Where a build came from, baked into main: release (pnpm release, sent to people), local (pnpm build and
// pnpm app:install, made from a checkout) or dev (pnpm dev and pnpm try), and the commit it was made at,
// with "+" when the checkout had changes. Only a release updates itself (core updates/).
export function buildLabel(channel) {
  const git = (...args) => execFileSync("git", ["-C", desktopDir, ...args], { encoding: "utf8" }).trim()
  let commit
  try {
    commit = git("rev-parse", "--short", "HEAD") + (git("status", "--porcelain") ? "+" : "")
  } catch {
    // Not a git checkout (a source archive)
  }
  return { channel, commit }
}

// Main and preload are bundled together with core, so a packaged app needs no node_modules. Preload is
// CommonJS because a sandboxed preload cannot be an ES module.
export function esbuildOptions({ production, channel }) {
  return {
    absWorkingDir: desktopDir,
    entryPoints: { main: "src/main.ts", preload: "src/preload.ts", "owlit-mcp": "../../packages/owlit-mcp/src/main.ts", "owlit-agent": "../../packages/owlit-agent/src/main.ts", owlit: "../../packages/cli/src/main.ts" },
    outdir: distDir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: production ? false : "linked",
    define: {
      "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
      "import.meta.url": "__importMetaUrl",
      // The share server links are made on, baked in at build time (OWLIT_SHARE_SERVER=https://… pnpm build);
      // none unless the build names one, so a build from source never makes links on someone else's server.
      // pnpm release reads it from .env.release.local (build.mjs); a run can still name another in its own
      // environment
      __OWLIT_SHARE_SERVER__: JSON.stringify(process.env.OWLIT_SHARE_SERVER ?? ""),
      __OWLIT_BUILD__: JSON.stringify(buildLabel(channel)),
    },
    // ES modules bundled into CommonJS (pdfium's loader) ask where they are through import.meta.url
    // (no require here: the sandboxed preload shares the banner and may not require node modules)
    banner: { js: 'const __importMetaUrl = typeof __filename === "string" ? "file://" + encodeURI(__filename) : "";' },
    logLevel: "warning",
    // core finds pdfium's wasm through import.meta.resolve when it isn't told where it is; main tells it
    logOverride: { "empty-import-meta": "silent" },
    plugins: [lingui({ production })],
  }
}

// Lingui for main and core, as @lingui/vite-plugin does it for the renderer: macros compiled by Lingui's
// native transform, and a .po catalog imported as its compiled messages. The config is the repo's.
function lingui({ production }) {
  const configPath = path.resolve(desktopDir, "../../lingui.config.ts")
  let config
  const loadConfig = async () => (config ??= (await import("@lingui/conf")).getConfig({ configPath }))
  return {
    name: "lingui",
    setup(build) {
      build.onLoad({ filter: /\.[cm]?tsx?$/ }, async (args) => {
        if (args.path.includes("/node_modules/")) return undefined
        const source = await readFile(args.path, "utf8")
        if (!/from ["']@lingui\/(core|react)\/macro["']/.test(source)) return undefined
        const { transform, mapMacroOptions } = await import("@lingui/native-tools")
        const { code } = await transform(source, path.basename(args.path), {
          macro: { ...mapMacroOptions(await loadConfig()), descriptorFields: production ? "id-only" : "all" },
          sourceMaps: production ? false : "inline",
        })
        return { contents: code, loader: "js" }
      })
      build.onLoad({ filter: /\.po$/ }, async (args) => {
        const conf = await loadConfig()
        const { getCatalogs, getCatalogForFile, createCompiledCatalog } = await import("@lingui/cli/api")
        const found = getCatalogForFile(path.relative(conf.rootDir, args.path), await getCatalogs(conf))
        if (!found) throw new Error(`${args.path} isn't one of lingui.config.ts's catalogs`)
        const { locale, catalog } = found
        const { messages } = await catalog.getTranslations(locale, { fallbackLocales: conf.fallbackLocales, sourceLocale: conf.sourceLocale })
        const pseudo = conf.pseudoLocale.find((item) => item.locale === locale)
        const { source, errors } = createCompiledCatalog(locale, messages, { namespace: "es", pseudoLocale: pseudo?.locale, pseudoLocaleOptions: pseudo?.options })
        return { contents: source, loader: "js", warnings: errors.map((e) => ({ text: `${locale}: ${e.id ?? ""} ${e.error ?? e}` })) }
      })
    },
  }
}

// Files main needs beside it at run time: pdfium's wasm (core reads PDFs with it)
export function copyMainAssets() {
  const fromCore = createRequire(path.join(desktopDir, "../../packages/core/package.json"))
  mkdirSync(distDir, { recursive: true })
  copyFileSync(fromCore.resolve("@embedpdf/pdfium/pdfium.wasm"), path.join(distDir, "pdfium.wasm"))
  // The example workspace the first-launch flow offers (workspace.createExample)
  const example = path.join(desktopDir, "resources", "example-workspace")
  if (existsSync(example)) cpSync(example, path.join(distDir, "example-workspace"), { recursive: true })
  // What's new after an update reads its version's section here, offline (core updates/)
  copyFileSync(path.join(desktopDir, "CHANGELOG.md"), path.join(distDir, "CHANGELOG.md"))
  // npm, which sets up owlit's own copy of Claude Code's and Codex's adapters (core agents/setup.ts). It
  // ships with its dependencies inside, so the folder is all it needs.
  const npm = path.dirname(createRequire(path.join(desktopDir, "package.json")).resolve("npm/package.json"))
  if (!existsSync(path.join(distDir, "npm", "package.json"))) cpSync(npm, path.join(distDir, "npm"), { recursive: true, dereference: true })
}
