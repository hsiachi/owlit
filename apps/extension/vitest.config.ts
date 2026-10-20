import path from "node:path"
import { lingui } from "@lingui/vite-plugin"
import { defineConfig } from "vitest/config"

// The extension's pure parts (reading a page, deciding what a click does and what it says), no browser.
// Their words are Lingui macros, compiled as the build compiles them; outside production they read as the
// English in the code.
export default defineConfig({
  plugins: [lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../../lingui.config.ts") })],
  test: { include: ["src/**/*.test.ts"] },
})
