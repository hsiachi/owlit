import path from "node:path"
import { lingui } from "@lingui/vite-plugin"
import { defineConfig } from "vitest/config"

// Getting PDFs end to end in one process: a real core, the extension's real fetching against core's real
// HTTP server, and the renderer's pure parts reading core's answers, all on a fake web. The renderer's
// files import each other as @/…; core's and the renderer's words are Lingui macros, compiled as the
// builds compile them. Each scenario starts a core, which a loaded machine can slow past vitest's 5 s.
export default defineConfig({
  plugins: [lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../../lingui.config.ts") })],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../app/src") } },
  test: { include: ["src/**/*.test.ts"], testTimeout: 30_000 },
})
