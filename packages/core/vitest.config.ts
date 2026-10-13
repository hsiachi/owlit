import path from "node:path"
import { defineConfig } from "vitest/config"
import { lingui } from "@lingui/vite-plugin"

// Core's messages that reach the screen are Lingui macros; tests compile them the way the app's bundle does
export default defineConfig({
  plugins: [lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../../lingui.config.ts") })],
})
