import { defineConfig } from "vitest/config"

// The extension's pure parts (reading a page, deciding about a PDF tab): no browser, no Lingui
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
})
