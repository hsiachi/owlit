import path from "node:path"
import { defineConfig } from "vitest/config"
import { lingui } from "@lingui/vite-plugin"

// The renderer's unit tests: pure helpers beside their sources. Kept apart from vite.config.ts so a test
// run doesn't start the React and Tailwind plugins; Lingui's macros still need compiling.
export default defineConfig({
  plugins: [lingui({ macroTransform: true, configPath: path.resolve(import.meta.dirname, "../lingui.config.ts") })],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: { include: ["src/**/*.test.ts"] },
})
