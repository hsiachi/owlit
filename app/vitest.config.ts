import path from "node:path"
import { defineConfig } from "vitest/config"

// The renderer's unit tests: pure helpers beside their sources. Kept apart from vite.config.ts so a test
// run doesn't start the React and Tailwind plugins.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  test: { include: ["src/**/*.test.ts"] },
})
