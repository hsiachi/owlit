import path from "node:path"
import { defineConfig } from "vitest/config"
import { lingui } from "@lingui/vite-plugin"

// Core's messages that reach the screen are Lingui macros; tests compile them the way the app's bundle does.
// Most tests start a real core, and many spawn processes (a fake agent, owlit-mcp), which a loaded machine
// can slow past vitest's 5 s default.
export default defineConfig({
  plugins: [lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../../lingui.config.ts") })],
  test: { testTimeout: 15_000 },
})
